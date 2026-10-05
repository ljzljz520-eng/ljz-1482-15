import axios, { AxiosError } from "axios";
import { toast } from "react-hot-toast";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
  timeout: 15000,
  headers: { "Content-Type": "application/json" }
});

/** 当前协作者身份（演示：在顶栏切换；持久化到 localStorage） */
export function getCurrentUserId(): string | null {
  return localStorage.getItem("tl_user_id");
}
export function setCurrentUserId(id: string) {
  localStorage.setItem("tl_user_id", id);
}

api.interceptors.request.use((config) => {
  const uid = getCurrentUserId();
  if (uid) config.headers["x-user-id"] = uid;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    // 409 冲突由业务层弹窗处理，不弹全局 toast
    const status = error.response?.status;
    if (status !== 409) {
      toast.error(error.response?.data?.message ?? "网络请求失败，请稍后重试", { duration: 3500 });
    }
    return Promise.reject(error);
  }
);

export default api;
