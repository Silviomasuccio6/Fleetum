import { FormEvent, useEffect, useState } from "react";
import { usersUseCases } from "../../../application/usecases/users-usecases";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

const ruoloLabel: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  OPERATOR: "Operatore",
  VIEWER: "Viewer"
};

const statoLabel: Record<string, string> = {
  ACTIVE: "Attivo",
  INVITED: "Invitato",
  SUSPENDED: "Sospeso"
};

export const UsersPage = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<Array<"ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER">>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    const [usersRes, rolesRes] = await Promise.all([usersUseCases.list(), usersUseCases.listRoles()]);
    setUsers(usersRes.data);
    setRoles(rolesRes.data);
    setLoading(false);
  };

  useEffect(() => {
    loadData().catch((e: Error) => {
      setError(e.message);
      setLoading(false);
    });
  }, []);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);

    try {
      await usersUseCases.create({
        firstName: String(form.get("firstName") || "").trim(),
        lastName: String(form.get("lastName") || "").trim(),
        email: String(form.get("email") || "").trim(),
        password: String(form.get("password") || ""),
        roleKey: String(form.get("roleKey") || "OPERATOR")
      });
      setSuccess("Utente creato correttamente.");
      formEl.reset();
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onRoleChange = async (userId: string, roleKey: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER") => {
    setError(null);
    try {
      await usersUseCases.updateRole(userId, roleKey);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onStatusChange = async (userId: string, status: "ACTIVE" | "INVITED" | "SUSPENDED") => {
    setError(null);
    try {
      await usersUseCases.update(userId, { status });
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onDelete = async (userId: string) => {
    setError(null);
    try {
      await usersUseCases.remove(userId);
      setSuccess("Utente disattivato.");
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);

    try {
      await usersUseCases.invite({
        firstName: String(form.get("inviteFirstName") || "").trim(),
        lastName: String(form.get("inviteLastName") || "").trim(),
        email: String(form.get("inviteEmail") || "").trim(),
        roleKey: String(form.get("inviteRoleKey") || "OPERATOR")
      });
      setSuccess("Invito inviato con successo (email in coda).");
      formEl.reset();
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) return <FleetumBlockLoader label="Caricamento utenti" />;
  if (error && users.length === 0)
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Riprova</Button>
      </div>
    );

  return (
    <section className="space-y-4">
      <PageHeader
        title="Utenti e Ruoli"
        subtitle="Gestione completa degli utenti interni: creazione, invito, ruolo, stato e disattivazione."
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Nuovo utente</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={onCreate}>
            <div className="grid gap-1.5">
              <Label>Nome</Label>
              <Input name="firstName" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Cognome</Label>
              <Input name="lastName" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input name="email" type="email" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Password</Label>
              <Input name="password" type="password" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Ruolo</Label>
              <Select name="roleKey" defaultValue={roles[0] ?? "OPERATOR"}>
                {roles.map((role) => (
                  <option key={role} value={role}>{ruoloLabel[role]}</option>
                ))}
              </Select>
            </div>
            <div className="xl:col-span-3">
              <Button type="submit">Crea utente</Button>
            </div>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          {success && <p className="mt-3 text-sm text-emerald-700">{success}</p>}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Invita utente</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={onInvite}>
            <div className="grid gap-1.5">
              <Label>Nome</Label>
              <Input name="inviteFirstName" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Cognome</Label>
              <Input name="inviteLastName" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input name="inviteEmail" type="email" required />
            </div>
            <div className="grid gap-1.5">
              <Label>Ruolo</Label>
              <Select name="inviteRoleKey" defaultValue={roles[0] ?? "OPERATOR"}>
                {roles.map((role) => (
                  <option key={role} value={role}>{ruoloLabel[role]}</option>
                ))}
              </Select>
            </div>
            <div className="xl:col-span-4">
              <Button type="submit" variant="secondary">Invia invito</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Gestione utenti</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {users.map((user) => {
              const role = user.roles?.[0] ?? "OPERATOR";
              return (
                <Card key={user.id} className="border-dashed">
                  <CardContent className="space-y-2 pt-4">
                    <p className="text-sm font-medium">{user.firstName} {user.lastName}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                    <Select value={role} onChange={(e) => onRoleChange(user.id, e.target.value as any)}>
                      {roles.map((r) => (
                        <option key={r} value={r}>{ruoloLabel[r]}</option>
                      ))}
                    </Select>
                    <Select value={user.status} onChange={(e) => onStatusChange(user.id, e.target.value as any)}>
                      <option value="ACTIVE">{statoLabel.ACTIVE}</option>
                      <option value="INVITED">{statoLabel.INVITED}</option>
                      <option value="SUSPENDED">{statoLabel.SUSPENDED}</option>
                    </Select>
                    <Button variant="destructive" size="sm" onClick={() => onDelete(user.id)}>Disattiva</Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden md:block">
            <Table className="text-[12px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Ruolo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const role = user.roles?.[0] ?? "OPERATOR";
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="text-xs font-medium">{user.firstName} {user.lastName}</TableCell>
                      <TableCell className="text-xs">{user.email}</TableCell>
                      <TableCell>
                        <Select className="h-7 text-[11px]" value={role} onChange={(e) => onRoleChange(user.id, e.target.value as any)}>
                          {roles.map((r) => (
                            <option key={r} value={r}>{ruoloLabel[r]}</option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select className="h-7 text-[11px]" value={user.status} onChange={(e) => onStatusChange(user.id, e.target.value as any)}>
                          <option value="ACTIVE">{statoLabel.ACTIVE}</option>
                          <option value="INVITED">{statoLabel.INVITED}</option>
                          <option value="SUSPENDED">{statoLabel.SUSPENDED}</option>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button variant="destructive" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onDelete(user.id)}>Disattiva</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
