import { useEffect } from "react";
import { LoginCard } from "./components/LoginCard";
import "./premium-login.css";

export const LoginPage = () => {
  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");

    return () => {
      if (previousTheme) {
        document.documentElement.setAttribute("data-theme", previousTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };
  }, []);

  return (
    <div className="premium-login-root premium-login-root--clean">
      <main className="premium-login-auth-shell">
        <LoginCard />
      </main>
    </div>
  );
};
