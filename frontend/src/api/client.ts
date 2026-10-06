import axios, { AxiosError } from "axios";
import { toast } from "react-hot-toast";

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api",
  timeout: 15000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("tl_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** 全局错误提示（409 冲突由调用方专门处理，不弹通用错误） */
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    if (error.config?.headers?.["X-Silent"]) return Promise.reject(error);
    const status = error.response?.status;
    if (status === 401) {
      if (!location.pathname.endsWith("/login")) toast.error("登录已过期，请重新登录");
    } else if (status !== 409) {
      toast.error(error.response?.data?.message ?? "网络请求失败，请稍后重试");
    }
    return Promise.reject(error);
  }
);

export default api;

/** 生成幂等键：保存响应丢失后用同一键安全重试 */
export function idempotencyKey(): string {
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
