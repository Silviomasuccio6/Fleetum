import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../application/stores/auth-store";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { AuthShell } from "../../components/layout/auth-shell";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { prefetchPrimaryTenantRoutes } from "../../routes/prefetch-routes";

export const LoginPage = () => {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    try {
      const result = await authUseCases.login({
        email: String(formData.get("email")),
        password: String(formData.get("password"))
      });
      const remember = formData.get("remember") === "on";
      setSession(result.user, remember);
      prefetchPrimaryTenantRoutes();
      navigate("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <AuthShell title="Accedi" subtitle="Inserisci email e password per entrare nel gestionale.">
      <form className="grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="nome@azienda.it" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" placeholder="********" required />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="remember" defaultChecked />
          Ricordami
        </label>
        {error && <Alert className="border-destructive/40 bg-destructive/10 text-destructive">{error}</Alert>}
        <Button type="submit">Accedi</Button>
        <Button type="button" variant="ghost" onClick={() => navigate("/forgot-password")}>Password dimenticata?</Button>
        <Button type="button" variant="outline" onClick={() => navigate("/signup")}>Crea account</Button>
      </form>
    </AuthShell>
  );
};
