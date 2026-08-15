import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HardHat, Plus, Pencil, Trash2, KeyRound, Phone } from "lucide-react";
import { toast } from "sonner";

type FormMode = "create" | "edit";

const emptyForm = {
  name: "",
  email: "",
  username: "",
  password: "",
  cpf: "",
  phone: "",
  specialization: "",
  active: 1,
};

export default function AdminTechnicians() {
  const adminId = parseInt(localStorage.getItem("adminId") ?? "0");

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>("create");
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwId, setPwId] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: technicians = [], isLoading, refetch } = (trpc as any).technicians.list.useQuery({ adminId });

  const createMutation = (trpc as any).technicians.create.useMutation({
    onSuccess: () => { toast.success("Técnico criado!"); setModalOpen(false); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = (trpc as any).technicians.update.useMutation({
    onSuccess: () => { toast.success("Técnico atualizado!"); setModalOpen(false); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updatePwMutation = (trpc as any).technicians.updatePassword.useMutation({
    onSuccess: () => { toast.success("Senha atualizada!"); setPwModalOpen(false); setNewPw(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = (trpc as any).technicians.delete.useMutation({
    onSuccess: () => { toast.success("Técnico removido!"); setDeleteId(null); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  function openCreate() {
    setMode("create");
    setEditId(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  }

  function openEdit(t: any) {
    setMode("edit");
    setEditId(t.id);
    setForm({
      name: t.name,
      email: t.email ?? "",
      username: t.username,
      password: "",
      cpf: t.cpf ?? "",
      phone: t.phone ?? "",
      specialization: t.specialization ?? "",
      active: t.active,
    });
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "create") {
      createMutation.mutate({
        adminId,
        name: form.name,
        email: form.email || undefined,
        username: form.username,
        password: form.password,
        cpf: form.cpf || undefined,
        phone: form.phone || undefined,
        specialization: form.specialization || undefined,
      });
    } else if (editId) {
      updateMutation.mutate({
        id: editId,
        name: form.name,
        email: form.email || undefined,
        cpf: form.cpf || undefined,
        phone: form.phone || undefined,
        specialization: form.specialization || undefined,
        active: form.active,
      });
    }
  }

  const filtered = (technicians as any[]).filter((t: any) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardHat className="w-7 h-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Técnicos</h1>
              <p className="text-sm text-muted-foreground">
                Gerencie os técnicos e seus acessos ao portal
              </p>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo Técnico</span>
          </Button>
        </div>

        {/* Busca */}
        <Input
          placeholder="Buscar por nome ou usuário..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        {/* Tabela */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Especialidade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhum técnico encontrado
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.username}</TableCell>
                    <TableCell>
                      {t.phone ? (
                        <span className="flex items-center gap-1 text-sm">
                          <Phone className="w-3 h-3" /> {t.phone}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{t.specialization || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={t.active ? "default" : "secondary"}>
                        {t.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setPwId(t.id); setPwModalOpen(true); }}
                          title="Alterar senha"
                        >
                          <KeyRound className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(t)} title="Editar">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(t.id)}
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Modal Criar/Editar */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Novo Técnico" : "Editar Técnico"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t-name">Nome *</Label>
              <Input
                id="t-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="t-username">Usuário *</Label>
                <Input
                  id="t-username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  disabled={mode === "edit"}
                  required={mode === "create"}
                />
              </div>
              {mode === "create" && (
                <div className="space-y-2">
                  <Label htmlFor="t-password">Senha *</Label>
                  <PasswordInput
                    id="t-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="t-cpf">CPF</Label>
                <Input
                  id="t-cpf"
                  value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                  placeholder="000.000.000-00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-phone">Telefone</Label>
                <Input
                  id="t-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-email">E-mail</Label>
              <Input
                id="t-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-spec">Especialidade</Label>
              <Input
                id="t-spec"
                value={form.specialization}
                onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                placeholder="Ex: Elétrica, Bombas, Geradores..."
              />
            </div>
            {mode === "edit" && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="t-active"
                  checked={form.active === 1}
                  onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })}
                  className="w-4 h-4"
                />
                <Label htmlFor="t-active" className="font-normal cursor-pointer">Ativo</Label>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {mode === "create" ? "Criar" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Senha */}
      <Dialog open={pwModalOpen} onOpenChange={setPwModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alterar Senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="new-pw">Nova senha</Label>
            <PasswordInput
              id="new-pw"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwModalOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => pwId && updatePwMutation.mutate({ id: pwId, newPassword: newPw })}
              disabled={newPw.length < 6 || updatePwMutation.isPending}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir técnico?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O técnico será desvinculado de todas as OS atribuídas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
