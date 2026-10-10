import { useState } from 'react';
import { Trash2, Edit, FrownIcon, Plus, Loader2, MessageSquare } from 'lucide-react';
import { usePOSStore } from '../store/pos-store';
import { cn } from '@ury/ui';
import { formatCurrency, parseFrappeError, flt } from '@ury/core';
import { CustomerSelect } from './CustomerSelect';
import ProductDialog from './ProductDialog';
import PaymentDialog from './PaymentDialog';
import OrderTypeSelect from './OrderTypeSelect';
import CommentDialog from './CommentDialog';
import OrderTabs from './OrderTabs';
import { Button, Spinner, Checkbox } from '@ury/ui';
import { syncOrder } from '../lib/order-api';
import { useRootStore } from '../store/root-store';
import type { RootState } from '../store/root-store';
import { showToast } from '@ury/ui';
import { DINE_IN } from '../data/order-types';
import { printOrder } from '../lib/print';
import { t } from '../i18n';

const OrderPanel = () => {
  const { 
    activeOrders, 
    removeFromOrder, 
    updateQuantity, 
    clearOrder, 
    setSelectedItem,
    orderLoading,
    isOrderInteractionDisabled,
    isUpdatingOrder,
    posProfile,
    selectedOrderType,
    selectedTable,
    selectedRoom,
    selectedCustomer,
    selectedAggregator,
    resetOrderState,
    paymentModes,
    orderId,
    orderComment,
    setOrderComment,
    noOfPax,
    setNoOfPax,
    lastModifiedTime
  } = usePOSStore();
  const user = useRootStore((state: RootState) => state.user);
  const [editingItem, setEditingItem] = useState<typeof activeOrders[0] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [printAndPay, setPrintAndPay] = useState(true);
  const [directPayment, setDirectPayment] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [currentOrderDetails, setCurrentOrderDetails] = useState<any>(null);

  const calculateItemTotal = (item: typeof activeOrders[0]) => {
    const basePrice = item.selectedVariant?.price || item.price;
    const addonsTotal = item.selectedAddons?.reduce((sum, addon) => sum + addon.price, 0) || 0;
    return flt((basePrice + addonsTotal) * item.quantity, 2);
  };

  const total = flt(
    activeOrders.reduce(
      (sum, item) => sum + calculateItemTotal(item),
      0
    ),
    2
  );

  const handleEdit = (item: typeof activeOrders[0]) => {
    const menuItem = {
      ...item,
      variants: item.variants,
      addons: item.addons,
    };
    setSelectedItem(menuItem);
    setEditingItem(item);
  };

  const handleCommentSave = (comment: string) => {
    setOrderComment(comment);
  };

  const handleDirectPayment = async (orderId: string) => {
    try {
      await call.post('ury.ury.doctype.ury_order.ury_order.make_invoice', {
        additionalDiscount: null,
        cashier: posProfile?.cashier || '',
        customer: selectedOrderType === 'Aggregators' ? selectedAggregator?.customer || '' : selectedCustomer?.name || '',
        invoice: orderId,
        owner: posProfile?.cashier || '',
        payments: [{ mode_of_payment: paymentModes[0], amount: total }],
        pos_profile: posProfile?.name || '',
        table: selectedTable || null,
      });
      
      showToast.success('Payment processed successfully');
      resetOrderState();
    } catch (error) {
      console.error('Direct payment failed:', error);
      showToast.error('Payment failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleSubmit = async () => {
    try {
      if (!posProfile) {
        throw new Error(t('errors.pos_profile_not_found'));
      }

      if (!user?.name) {
        throw new Error(t('errors.user_not_logged_in'));
      }

      // Validate customer/aggregator details
      if (selectedOrderType === 'Aggregators') {
        if (!selectedAggregator?.customer) {
          showToast.error(t('errors.select_aggregator'));
          return;
        }
      } else if (!selectedCustomer?.name) {
        showToast.error(t('errors.select_customer'));
        return;
      }

      // Validate table selection for dine-in orders
      if (selectedOrderType === DINE_IN && !selectedTable) {
        showToast.error(t('errors.select_table', { order_type: DINE_IN }));
        return;
      }

      setIsSubmitting(true);
      
      const orderData = {
        items: activeOrders.map(item => ({
          item: item.id,
          item_name: item.name,
          rate: item.selectedVariant?.price || item.price,
          qty: item.quantity,
          comment: item.comment || undefined
        })),
        no_of_pax: noOfPax,
        pos_profile: posProfile.name,
        order_type: selectedOrderType,
        table: selectedTable || undefined,
        room: selectedRoom || undefined,
        customer: selectedOrderType === 'Aggregators' ? selectedAggregator?.customer : selectedCustomer?.name,
        aggregator_id: selectedOrderType === 'Aggregators' ? selectedAggregator?.customer : undefined,
        cashier: posProfile.cashier,
        owner: posProfile.owner,
        mode_of_payment: paymentModes[0],
        last_invoice: isUpdatingOrder ? orderId : null,
        last_modified_time: isUpdatingOrder ? (lastModifiedTime || undefined) : undefined,
        invoice: isUpdatingOrder ? orderId : null,
        waiter: user.name,
        comments: orderComment || undefined
      };

      const result = await syncOrder(orderData);

      // sync_order returns { status: 'Failure' } instead of throwing when the
      // write is rejected (stale last_modified_time, table already occupied,
      // or the invoice was already billed by another user).
      if (result?.message && typeof result.message === 'object' && 'status' in result.message && result.message.status === 'Failure') {
        showToast.error(isUpdatingOrder ? t('errors.order_modified') : t('errors.order_sync_failed'));
        return;
      }

      if (printAndPay && result?.message?.name) {
        setCurrentOrderId(result.message.name);

        setIsPrinting(true);
        try {
          await printOrder({ orderId: result.message.name, posProfile });
          showToast.success('Order printed successfully');

          if (directPayment) {
            await handleDirectPayment(result.message.name);
          } else {
            setShowPaymentDialog(true);
          }
        } catch (printError) {
          console.error('Failed to print order:', printError);
          showToast.error('Failed to print order. Order saved as draft.');
          resetOrderState();
        } finally {
          setIsPrinting(false);
        }
      } else {
        resetOrderState();
        showToast.success(isUpdatingOrder ? t('success.order_updated') : t('success.order_created'));
      }
    } catch (error) {
      console.error('Failed to sync order:', error);
      showToast.error(parseFrappeError(error, t('errors.failed_process_order')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const MIN_PAX = 1;
  const MAX_PAX = 50;

  const handlePaxDecrement = () => {
    setNoOfPax(Math.max(MIN_PAX, noOfPax - 1));
  };

  const handlePaxIncrement = () => {
    setNoOfPax(Math.min(MAX_PAX, noOfPax + 1));
  };

  const EmptyCartUI = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
        <FrownIcon className="w-12 h-12 text-gray-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {t('cart.empty_title')}
      </h3>

      <p className="text-gray-500 text-sm mb-6 max-w-xs leading-relaxed">
        {t('cart.empty_subtitle')}
      </p>

      <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2 rounded-lg">
        <Plus className="w-4 h-4" />
        <span className="text-sm font-medium">{t('cart.click_to_add')}</span>
      </div>

      <div className="mt-4 text-xs text-gray-400">
        {t('cart.double_click_hint')}
      </div>
    </div>
  );

  const LoadingOrderUI = () => (
    <div className="h-96">
      <Spinner message={t('cart.loading_order')} />
    </div>
  );

  const isInteractionDisabled = isOrderInteractionDisabled() || isSubmitting;

  return (
    <div className="w-96 bg-white border-s border-gray-200 flex flex-col h-[calc(100vh-4rem)] fixed end-0 z-10">
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <OrderTabs disabled={isInteractionDisabled} />
        <OrderTypeSelect disabled={isInteractionDisabled} />
        <div className="mt-3"><CustomerSelect disabled={isInteractionDisabled} /></div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{t('cart.pax')}</span>
          <div className="flex items-center gap-2">
            <Button
              onClick={handlePaxDecrement}
              variant="outline"
              size="icon"
              className="w-8 h-8 rounded-full"
              disabled={isInteractionDisabled || noOfPax <= MIN_PAX}
            >
              -
            </Button>
            <span className="w-6 text-center">{noOfPax}</span>
            <Button
              onClick={handlePaxIncrement}
              variant="outline"
              size="icon"
              className="w-8 h-8 rounded-full"
              disabled={isInteractionDisabled || noOfPax >= MAX_PAX}
            >
              +
            </Button>
          </div>
        </div>
      </div>
      
      {orderLoading ? (
        <LoadingOrderUI />
      ) : activeOrders.length === 0 ? (
        <EmptyCartUI />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-6">
            {activeOrders.map((item) => (
              <div
                key={item.uniqueId}
                className={cn(
                  "flex flex-col py-4 border-b border-gray-100",
                  isInteractionDisabled && "opacity-50"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-gray-900 text-sm">{item.name}</h3>
                    </div>
                    {item.selectedVariant && (
                      <p className="text-sm text-gray-600">{item.selectedVariant.name}</p>
                    )}
                    {item.selectedAddons && item.selectedAddons.length > 0 && (
                      <p className="text-sm text-gray-500">
                        {item.selectedAddons.map(addon => addon.name).join(', ')}
                      </p>
                    )}
                    {item.comment && item.comment.trim() && (
                      <p className="text-xs text-gray-500 italic mt-0.5 truncate">
                        "{item.comment.trim()}"
                      </p>
                    )}
                    <p className="text-gray-600 text-sm">{formatCurrency(calculateItemTotal(item))}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => handleEdit(item)}
                      variant="ghost"
                      size="icon"
                      className="text-blue-600 hover:text-blue-700"
                      title={t('cart.edit_item')}
                      disabled={isInteractionDisabled}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => {
                          const newQuantity = Math.max(0, Math.round((item.quantity - 1) * 1000) / 1000);
                          if (newQuantity <= 0) {
                            removeFromOrder(item.uniqueId!);
                          } else {
                            updateQuantity(item.uniqueId!, newQuantity);
                          }
                        }}
                        variant="outline"
                        size="icon"
                        className="w-8 h-8 rounded-full"
                        disabled={isInteractionDisabled}
                      >
                        -
                      </Button>
                      <span className="w-6 text-center">{item.quantity}</span>
                      <Button
                        onClick={() => updateQuantity(item.uniqueId!, Math.round((item.quantity + 1) * 1000) / 1000)}
                        variant="outline"
                        size="icon"
                        className="w-8 h-8 rounded-full"
                        disabled={isInteractionDisabled}
                      >
                        +
                      </Button>
                    </div>
                    
                    <Button
                      onClick={() => removeFromOrder(item.uniqueId!)}
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-600"
                      disabled={isInteractionDisabled}
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {activeOrders.length > 0 && (
              <Button
                onClick={clearOrder}
                variant="ghost"
                size="sm"
                className="w-full text-gray-600 hover:text-gray-800 mt-4"
                disabled={isInteractionDisabled}
              >
                {t('cart.clear_cart')}
              </Button>
            )}
          </div>
          
          <div className="p-4 border-t border-gray-200 flex-shrink-0 bg-white">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setShowCommentDialog(true)}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 w-8 p-0",
                    orderComment ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                  )}
                  disabled={isInteractionDisabled}
                  title={orderComment ? t('cart.edit_comment') : t('cart.add_comment')}
                >
                  <MessageSquare className="w-4 h-4" />
                </Button>
                <span className="text-lg font-semibold">{t('cart.total')}</span>
              </div>
              <span className="text-lg font-semibold">{formatCurrency(total)}</span>
            </div>
            {/* Print and Pay Checkbox */}
            <div className="flex items-center space-x-2 mb-4">
              <Checkbox
                id="printAndPay"
                checked={printAndPay}
                onCheckedChange={(checked) => setPrintAndPay(checked as boolean)}
                disabled={isInteractionDisabled}
              />
              <label
                htmlFor="printAndPay"
                className="text-sm font-medium text-gray-700 cursor-pointer"
              >
                Print and Submit
              </label>
            </div>
            
            {/* Direct Payment Checkbox */}
            <div className="flex items-center space-x-2 mb-4">
              <Checkbox
                id="directPayment"
                checked={directPayment}
                onCheckedChange={(checked) => setDirectPayment(checked as boolean)}
                disabled={isInteractionDisabled}
              />
              <label
                htmlFor="directPayment"
                className="text-sm font-medium text-gray-700 cursor-pointer"
              >
                Direct payment (no dialog)
              </label>
            </div>
            
            <Button
              onClick={handleSubmit}
              variant="default"
              size="default"
              className="w-full"
              disabled={isInteractionDisabled || isPrinting}
            >
              {isSubmitting ? (
                <div className="flex items-center">
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />

                  {isUpdatingOrder ? t('cart.updating_order') : t('cart.processing_order')}
                </div>
              ) : isPrinting ? (
                <div className="flex items-center">
                  <Spinner className="w-4 h-4 mr-2" hideMessage />
                  Printing...
                </div>
              ) : isUpdatingOrder ? (
                t('cart.update_order')
              ) : printAndPay && directPayment ? (
                'Print & Pay Direct'
              ) : printAndPay ? (
                'Print & Open Payment'
              ) : (
                t('cart.add_new_order')
              )}
            </Button>
          </div>
        </>
      )}

      {editingItem && (
        <ProductDialog
          onClose={() => {
            setEditingItem(null);
            setSelectedItem(null);
          }}
          editMode
          initialVariant={editingItem.selectedVariant}
          initialAddons={editingItem.selectedAddons}
          initialQuantity={editingItem.quantity}
          itemToReplace={editingItem}
        />
      )}

      <CommentDialog
        isOpen={showCommentDialog}
        onClose={() => setShowCommentDialog(false)}
        onSave={handleCommentSave}
        initialComment={orderComment}
      />

      {/* Payment Dialog */}
      {showPaymentDialog && currentOrderId && posProfile && (
        <PaymentDialog
          onClose={() => {
            setShowPaymentDialog(false);
            setCurrentOrderId(null);
            resetOrderState();
          }}
          grandTotal={total}
          roundedTotal={total}
          invoice={currentOrderId}
          customer={selectedOrderType === 'Aggregators' ? selectedAggregator?.customer || '' : selectedCustomer?.name || ''}
          posProfile={posProfile.name}
          table={selectedTable || null}
          cashier={posProfile.cashier}
          owner={posProfile.cashier}
          fetchOrders={async () => {}}
          clearSelectedOrder={() => {
            setShowPaymentDialog(false);
            setCurrentOrderId(null);
            resetOrderState();
          }}
        />
      )}
    </div>
  );
};

export default OrderPanel;