import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "@/api/timeline";
import { toast } from "react-hot-toast";

const Login = () => {
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login(username.trim(), password);
      localStorage.setItem("tl_token", res.token);
      localStorage.setItem("tl_user", JSON.stringify(res.user));
      localStorage.setItem("tl_role", res.user.role);
      toast.success(`欢迎回来，${res.user.displayName}`);
      nav("/timeline");
    } catch {
      // 拦截器已弹 toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white/90 backdrop-blur shadow-card border border-white p-8">
        <div className="flex flex-col items-center mb-6">
          <span className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-2xl shadow-card mb-3">
            🎞️
          </span>
          <h1 className="text-xl font-bold text-slate-900">云溪多轨剪辑工作台</h1>
          <p className="text-sm text-slate-500 mt-1">精确 tick 时间基 · 多轨协作 · 冻结渲染</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
              placeholder="admin / editor"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
              placeholder="123456"
            />
          </div>
          <button
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-card hover:opacity-90 active:scale-[0.98] transition disabled:opacity-60"
          >
            {loading ? "登录中…" : "登 录"}
          </button>
        </form>
        <p className="mt-5 text-center text-[11px] text-slate-400">
          演示账号：admin/123456（管理员，可退役素材）· editor/123456（协作剪辑师）
        </p>
      </div>
    </div>
  );
};

export default Login;
