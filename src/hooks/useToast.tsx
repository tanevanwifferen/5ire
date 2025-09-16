import {
  useId,
  useToastController,
  Toast,
  ToastTitle,
  ToastBody,
  ToastIntent,
} from '@fluentui/react-components';

import {
  Dismiss16Regular,
  Dismiss16Filled,
  bundleIcon,
} from '@fluentui/react-icons';

const DismissIcon = bundleIcon(Dismiss16Filled, Dismiss16Regular);

/**
 * Custom hook that provides toast notification functionality using Fluent UI components.
 * Returns methods to display different types of toast notifications (error, warning, info, success).
 * 
 * @returns {Object} An object containing notification methods
 * @returns {Function} returns.notifyError - Displays an error toast with the provided message
 * @returns {Function} returns.notifyWarning - Displays a warning toast with the provided message
 * @returns {Function} returns.notifyInfo - Displays an info toast with the provided message
 * @returns {Function} returns.notifySuccess - Displays a success toast with the provided message
 */
export default function useToast() {
  const { dispatchToast, dismissToast } = useToastController('toaster');
  const toastId = useId('5ire');
  
  /**
   * Internal function that dispatches a toast notification with custom title, message, and intent.
   * 
   * @param {Object} params - The toast parameters
   * @param {string} params.title - The title text for the toast
   * @param {string} params.message - The message content for the toast
   * @param {ToastIntent} params.intent - The intent type that determines the toast appearance
   */
  const $notify = ({
    title,
    message,
    intent,
  }: {
    title: string;
    message: string;
    intent: ToastIntent;
  }) => {
    dispatchToast(
      <Toast>
        <ToastTitle>
          <div className="flex justify-between items-center w-full">
            <strong>{title}</strong>
            <DismissIcon onClick={dismiss} />
          </div>
        </ToastTitle>
        <ToastBody>
          <div style={{ width: '95%' }} className="toast-content">
            {message}
          </div>
        </ToastBody>
      </Toast>,
      { toastId, intent, pauseOnHover: true, position: 'top-end' },
    );
  };
  
  /**
   * Dismisses the current toast notification.
   */
  const dismiss = () => dismissToast(toastId);

  /**
   * Displays an error toast notification with the provided message.
   * 
   * @param {string} message - The error message to display
   */
  const notifyError = (message: string) =>
    $notify({ title: 'Error', message, intent: 'error' });
    
  /**
   * Displays a warning toast notification with the provided message.
   * 
   * @param {string} message - The warning message to display
   */
  const notifyWarning = (message: string) =>
    $notify({ title: 'Warning', message, intent: 'warning' });
    
  /**
   * Displays an info toast notification with the provided message.
   * 
   * @param {string} message - The info message to display
   */
  const notifyInfo = (message: string) =>
    $notify({ title: 'Info', message, intent: 'info' });
    
  /**
   * Displays a success toast notification with the provided message.
   * 
   * @param {string} message - The success message to display
   */
  const notifySuccess = (message: string) =>
    $notify({ title: 'Success', message, intent: 'success' });
  return { notifyError, notifyWarning, notifyInfo, notifySuccess };
}
