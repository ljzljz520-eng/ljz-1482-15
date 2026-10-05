import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import EditorPage from "./pages/EditorPage";
import RendersPage from "./pages/RendersPage";
import AssetsPage from "./pages/AssetsPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster } from "react-hot-toast";

const App = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<EditorPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/renders" element={<RendersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" />
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default App;
