import { toast as sonnerToast } from "sonner";

type ToastMessage = string | React.ReactNode;

function success(message: ToastMessage) {
  sonnerToast.success(message);
}

function error(message: ToastMessage) {
  sonnerToast.error(message);
}

function promise<T>(
  promise: Promise<T>,
  opts: {
    loading: ToastMessage;
    success: ToastMessage | ((data: T) => ToastMessage);
    error: ToastMessage | ((err: unknown) => ToastMessage);
  }
) {
  return sonnerToast.promise(promise, opts);
}

function info(message: ToastMessage) {
  sonnerToast.info(message);
}

function warning(message: ToastMessage) {
  sonnerToast.warning(message);
}

function dismiss(id?: string | number) {
  sonnerToast.dismiss(id);
}

export const toast = { success, error, promise, info, warning, dismiss };
