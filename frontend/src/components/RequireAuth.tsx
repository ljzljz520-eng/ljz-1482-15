import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { authApi } from "@/api/timeline";

/** 路由守卫：无 token 直接跳登录；token 失效由 401 拦截处理 */
const RequireAuth = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<"checking" | "ok" | "bad">(
    localStorage.getItem("tl_token") ? "checking" : "bad"
  );

  useEffect(() => {
    const token = localStorage.getItem("tl_token");
    if (!token) {
      setState("bad");
      return;
    }
    authApi
      .me()
      .then(() => setState("ok"))
      .catch(() => {
        localStorage.removeItem("tl_token");
        setState("bad");
      });
  }, []);

  if (state === "bad") return <Navigate to="/login" replace />;
  if (state === "checking") {
    return (
      <div className="p-10 flex justify-center">
        <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }
  return <>{children}</>;
};

export default RequireAuth;
