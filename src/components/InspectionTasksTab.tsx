import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, ClipboardList, Loader2, Trash2, Edit2, X } from "lucide-react";
import ChecklistForm from "./ChecklistForm";

interface InspectionTasksTabProps {
  workOrderId: number;
}

export default function InspectionTasksTab({ workOrderId }: InspectionTasksTabProps) {
  const [isAddChecklistOpen, setIsAddChecklistOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [customTitle, setCustomTitle] = useState("");
  const [editingChecklistId, setEditingChecklistId] = useState<number | null>(null);
  const [deleteChecklistDialogOpen, setDeleteChecklistDialogOpen] = useState<number | null>(null);
  const [savingChecklistId, setSavingChecklistId] = useState<number | null>(null);

  const { data: inspectionTasks, isLoading: isLoadingTasks, refetch: refetchTasks } = trpc.checklists.inspectionTasks.listByWorkOrder.useQuery(
    { workOrderId },
    { refetchOnMount: true, refetchOnWindowFocus: false }
  );

  const { data: checklists = [], isLoading: isLoadingChecklists, refetch: refetchChecklists } = trpc.checklists.instances.listByWorkOrder.useQuery(
    { workOrderId },
    { refetchOnMount: true, refetchOnWindowFocus: false }
  );

  const { data: templates = [] } = trpc.checklists.templates.list.useQuery();

  const invalidate = async () => {
    await Promise.all([refetchTasks(), refetchChecklists()]);
  };

  const createTaskMutation = trpc.checklists.inspectionTasks.create.useMutation({
    onSuccess: async () => {
      await refetchTasks();
      setIsAddChecklistOpen(true);
    },
    onError: (err: { message: string }) => {
      toast.error(`Erro ao inicializar inspeção: ${err.message}`);
    },
  });

  const createChecklistMutation = trpc.checklists.instances.create.useMutation({
    onSuccess: async () => {
      toast.success("Checklist adicionado com sucesso!");
      await invalidate();
      setIsAddChecklistOpen(false);
      setSelectedTemplateId("");
      setCustomTitle("");
    },
    onError: (err: { message: string }) => {
      toast.error(`Erro ao adicionar checklist: ${err.message}`);
    },
  });

  const deleteChecklistMutation = trpc.checklists.instances.delete.useMutation({
    onSuccess: async () => {
      toast.success("Checklist removido com sucesso!");
      await invalidate();
      setDeleteChecklistDialogOpen(null);
    },
    onError: (err: { message: string }) => {
      toast.error(`Erro ao remover checklist: ${err.message}`);
      setDeleteChecklistDialogOpen(null);
    },
  });

  const updateResponsesMutation = trpc.checklists.instances.updateResponses.useMutation({
    onSuccess: async () => {
      toast.success("Respostas salvas com sucesso!");
      setSavingChecklistId(null);
      await invalidate();
    },
    onError: (err: { message: string }) => {
      toast.error(`Erro ao salvar respostas: ${err.message}`);
      setSavingChecklistId(null);
    },
  });

  const aiSuggestMutation = trpc.checklists.instances.suggestConclusion.useMutation({
    onError: (e: any) => toast.error("Erro na sugestão de IA: " + e.message),
  });

  // Mutation para criar anexo a partir de foto tirada no checklist
  const createAttachmentMutation = trpc.workOrders.attachments.create.useMutation({
    onError: (err: { message: string }) => {
      toast.error(`Erro ao salvar foto: ${err.message}`);
    },
  });

  /**
   * Faz upload da foto para o Cloudinary e cria o anexo na OS.
   * Chamado pelo ChecklistForm quando o usuário tira foto de um item.
   */
  async function handleAddPhoto(caption: string, file: File) {
    const formData = new FormData();
    formData.append("files", file);

    const res = await fetch("/api/work-orders/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Erro no upload");

    const uploaded = data.urls[0];
    await createAttachmentMutation.mutateAsync({
      workOrderId,
      fileName:    uploaded.fileName,
      fileKey:     uploaded.key,
      fileUrl:     uploaded.url,
      fileType:    uploaded.fileType,
      fileSize:    uploaded.fileSize,
      category:    "during",
      description: caption || undefined,
    });

    toast.success("Foto salva na aba Anexos!");
  }

  const handleOpenAddChecklist = () => {
    if (!inspectionTasks || inspectionTasks.length === 0) {
      createTaskMutation.mutate({
        workOrderId,
        title: "Checklists de Equipamentos",
      });
    } else {
      setIsAddChecklistOpen(true);
    }
  };

  const handleAddChecklist = () => {
    const taskId = inspectionTasks?.[0]?.id;
    if (!taskId || !selectedTemplateId || !customTitle.trim()) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    createChecklistMutation.mutate({
      inspectionTaskId: taskId,
      templateId: parseInt(selectedTemplateId),
      customTitle,
    });
  };

  if (isLoadingTasks || isLoadingChecklists) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const addButton = (
    <Button onClick={handleOpenAddChecklist} disabled={createTaskMutation.isPending}>
      {createTaskMutation.isPending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Plus className="h-4 w-4 mr-2" />
      )}
      Adicionar Checklist
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <h3 className="text-lg font-medium">Checklists de Equipamentos</h3>

      {/* Lista de checklists */}
      {checklists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground mb-4" />
            <h4 className="font-medium mb-2">Nenhum checklist adicionado</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Clique em "Adicionar Checklist" para incluir equipamentos a inspecionar.
            </p>
            {addButton}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {checklists.map((checklist: { id: number; templateId: number; customTitle: string; brand: string | null; power: string | null; responses: string | null; isComplete: number | null; inspectionTaskId: number }) => {
            const template = templates.find((t: { id: number }) => t.id === checklist.templateId) ?? null;

            let formStructure = null;
            if (template?.formStructure) {
              try {
                const parsed = JSON.parse(template.formStructure);
                formStructure = parsed.fields && !parsed.sections
                  ? { sections: [{ id: "default", title: "Informações", fields: parsed.fields }] }
                  : parsed;
              } catch {
                // ignore parse error
              }
            }

            const responses = checklist.responses ? JSON.parse(checklist.responses) : {};
            // tipo_bomba_1 (novo template) ou tipo_bomba (legado)
            const tipoBomba = (responses?.tipo_bomba_1 ?? responses?.tipo_bomba) as string | undefined;
            const isSaving = savingChecklistId === checklist.id && updateResponsesMutation.isPending;
            const isEditing = editingChecklistId === checklist.id;

            return (
              <Card key={checklist.id}>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{checklist.customTitle}</CardTitle>
                      <CardDescription className="text-xs">
                        {/* Para o template unificado de Bomba, mostra o tipo selecionado */}
                        {template?.name}{tipoBomba ? ` de ${tipoBomba}` : ""}
                        {checklist.brand && ` • ${checklist.brand}`}
                        {checklist.power && ` • ${checklist.power}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={checklist.isComplete ? "default" : "secondary"}>
                        {checklist.isComplete ? "Completo" : "Incompleto"}
                      </Badge>
                      {checklist.isComplete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingChecklistId(isEditing ? null : checklist.id)}
                          className="h-8 px-2 text-xs"
                        >
                          {isEditing ? (
                            <><X className="h-3 w-3 mr-1" />Cancelar</>
                          ) : (
                            <><Edit2 className="h-3 w-3 mr-1" />Editar</>
                          )}
                        </Button>
                      )}
                      <AlertDialog
                        open={deleteChecklistDialogOpen === checklist.id}
                        onOpenChange={(open) => {
                          if (!open && !deleteChecklistMutation.isPending) {
                            setDeleteChecklistDialogOpen(null);
                          }
                        }}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDeleteChecklistDialogOpen(checklist.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover Checklist?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita. O checklist e todas as respostas serão removidos.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleteChecklistMutation.isPending}>
                              Cancelar
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteChecklistMutation.mutate({ id: checklist.id })}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              disabled={deleteChecklistMutation.isPending}
                            >
                              {deleteChecklistMutation.isPending ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Removendo...</>
                              ) : "Remover"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {formStructure && (
                    <ChecklistForm
                      formStructure={formStructure}
                      initialResponses={responses}
                      onSave={(newResponses, isComplete) => {
                        setSavingChecklistId(checklist.id);
                        updateResponsesMutation.mutate({ id: checklist.id, responses: newResponses, isComplete });
                        setEditingChecklistId(null);
                      }}
                      isSaving={isSaving}
                      readOnly={!!checklist.isComplete && !isEditing}
                      onAddPhoto={handleAddPhoto}
                      checklistId={checklist.id}
                      onAiSuggest={(id) => aiSuggestMutation.mutateAsync({ checklistInstanceId: id })}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
          {/* Botão abaixo do último checklist */}
          <div className="flex justify-start pt-1">
            {addButton}
          </div>
        </div>
      )}

      {/* Dialog para adicionar checklist */}
      <Dialog
        open={isAddChecklistOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddChecklistOpen(false);
            setSelectedTemplateId("");
            setCustomTitle("");
          }
        }}
      >
        <DialogContent className="max-w-md w-full">
          <DialogHeader>
            <DialogTitle>Adicionar Checklist</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo de Checklist *</Label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="" disabled>Selecione o tipo</option>
                {/* Mostra apenas templates ativos no dropdown de criação */}
                {templates.filter((t: { id: number; name: string; active: number }) => t.active !== 0).map((template: { id: number; name: string }) => (
                  <option key={template.id} value={template.id.toString()}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              {/* O tipo de equipamento (ex: Recalque, Dreno) é selecionado dentro do checklist.
                  Aqui identifica-se apenas a localização/subtítulo para diferenciar instâncias. */}
              <Label>Subtítulo / Localização *</Label>
              <Input
                placeholder="Ex: Torre 1, Bloco A, Subsolo"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="h-11"
              />
            </div>

          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsAddChecklistOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddChecklist} disabled={createChecklistMutation.isPending}>
              {createChecklistMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
