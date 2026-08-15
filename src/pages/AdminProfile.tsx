import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { User, Lock, Upload } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";


export default function AdminProfile() {
  const [, setLocation] = useLocation();
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // Profile form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  
  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Queries e mutations
  const { data: profile, isLoading: profileLoading } = trpc.adminProfile.getProfile.useQuery();

  const updateProfileMutation = trpc.adminProfile.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Perfil atualizado com sucesso!");
      setIsEditingProfile(false);
    },
    onError: (error) => {
      toast.error("Erro ao atualizar perfil: " + error.message);
    },
  });

  const changePasswordMutation = trpc.adminAuth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
      setIsChangingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) => {
      toast.error("Erro ao alterar senha: " + error.message);
    },
  });


  // Carregar dados do perfil
  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setPhone(profile.phone || "");
      setEmail(profile.email || "");
      setProfilePhoto(profile.profilePhoto || null);
    }
  }, [profile]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Nome não pode estar vazio");
      return;
    }
    await updateProfileMutation.mutateAsync({
      name: name.trim(),
      phone: phone.trim() || undefined,
      profilePhoto: profilePhoto || undefined,
    });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não conferem");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("A nova senha deve ter no mínimo 6 caracteres");
      return;
    }
    await changePasswordMutation.mutateAsync({
      currentPassword,
      newPassword,
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  if (profileLoading) {
    return <DashboardLayout><div className="flex items-center justify-center py-20">Carregando...</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Custom Label Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Label Customizado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Defina como você quer ser identificado na página inicial
              </p>
              <Button
                onClick={() => setLocation("/gestor/edit-custom-label")}
                className="w-full"
              >
                Editar Label
              </Button>
            </CardContent>
          </Card>

          {/* Profile Photo Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5" />
                Foto de Perfil
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt="Perfil"
                  className="w-32 h-32 rounded-lg object-cover mx-auto"
                />
              ) : (
                <div className="w-32 h-32 rounded-lg bg-gray-200 mx-auto flex items-center justify-center">
                  <User className="w-16 h-16 text-gray-400" />
                </div>
              )}
              <label className="block">
                <span className="sr-only">Escolher foto</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={(e) => {
                    const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                    input?.click();
                  }}
                >
                  <Upload className="w-4 h-4" />
                  Alterar Foto
                </Button>
              </label>
            </CardContent>
          </Card>

          {/* Profile Info Section */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Informações Pessoais</span>
                {!isEditingProfile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingProfile(true)}
                  >
                    Editar
                  </Button>
                )}
              </CardTitle>
              <CardDescription>
                {isEditingProfile ? "Atualize seus dados" : "Seus dados pessoais"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isEditingProfile ? (
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Seu nome"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      disabled
                      className="bg-gray-100"
                    />
                    <p className="text-xs text-gray-500">E-mail não pode ser alterado</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                    />
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button
                      type="submit"
                      disabled={updateProfileMutation.isPending}
                    >
                      Salvar Alterações
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsEditingProfile(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Nome</p>
                    <p className="font-medium text-gray-900">{name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">E-mail</p>
                    <p className="font-medium text-gray-900">{email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Telefone</p>
                    <p className="font-medium text-gray-900">{phone || "Não informado"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Change Password Section */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Alterar Senha
              </span>
              {!isChangingPassword && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsChangingPassword(true)}
                >
                  Alterar
                </Button>
              )}
            </CardTitle>
            <CardDescription>
              {isChangingPassword ? "Digite sua senha atual e a nova senha" : "Mantenha sua conta segura"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isChangingPassword ? (
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Senha Atual</Label>
                  <PasswordInput
                    id="currentPassword"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Digite sua senha atual"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">Nova Senha</Label>
                  <PasswordInput
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Digite a nova senha"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar Nova Senha</Label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirme a nova senha"
                    required
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="submit"
                    disabled={changePasswordMutation.isPending}
                  >
                    Alterar Senha
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsChangingPassword(false);
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-gray-600">Clique em "Alterar" para mudar sua senha</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
