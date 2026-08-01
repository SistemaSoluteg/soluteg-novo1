// Componente InspectionTaskItem — substitui o bloco correspondente em InspectionTasksTab.tsx
// ✅ FIXES:
//   1. addChecklistMutation agora invalida TAMBÉM listByWorkOrder (contagem no header atualiza)
//   2. Botão "Adicionar Checklist" não fecha o form ao ser clicado novamente se já aberto
//   3. Form inline tem feedback visual claro de estado aberto/fechado

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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} 

from "@/components/ui/dialog";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} 

from "@/components/ui/accordion";
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
import {
  Plus,
  ClipboardList,
  Loader2,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Edit2,
  X,
} from "lucide-react";
import ChecklistForm from "./ChecklistForm";

interface InspectionTaskItemProps {
  task: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    completedAt: Date | null;
  };
  templates: Array<{ id: number; name: string; formStructure: string }>;
  workOrderId: number; // ✅ necessário para invalidar a query correta
  onDeleteTask: (taskId: number) => void;
  onDeleteChecklist: (checklistId: number) => void;
  onSaveResponses: (checklistId: number, responses: Record<string, unknown>, isComplete: boolean) => void;
  onCompleteTask: (taskId: number) => void;
  isSavingResponses: boolean;
  deleteChecklistDialogOpen: number | null;
  setDeleteChecklistDialogOpen: (id: number | null) => void;
  deleteChecklistMutation: { isPending: boolean };
}

export function InspectionTaskItem({
  task,
  templates,
  workOrderId,
  onDeleteTask,
  onDeleteChecklist,
  onSaveResponses,
  onCompleteTask,
  isSavingResponses,
  deleteChecklistDialogOpen,
  setDeleteChecklistDialogOpen,
  deleteChecklistMutation,
}: InspectionTaskItemProps) {
  const [showAddChecklistForm, setShowAddChecklistForm] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [customTitle, setCustomTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [power, setPower] = useState("");
  const [editingChecklistId, setEditingChecklistId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // ✅ FIX: invalida AMBAS as queries para que o badge de contagem e a lista atualizem
  const addChecklistMutation = trpc.checklists.instances.create.useMutation({
    onSuccess: async () => {
      toast.success("Checklist adicionado com sucesso!");
      setShowAddChecklistForm(false);
      setSelectedTemplateId("");
      setCustomTitle("");
      setBrand("");
      setPower("");
      await Promise.all([
        utils.checklists.instances.listByTask.invalidate({ inspectionTaskId: task.id }),
        utils.checklists.inspectionTasks.listByWorkOrder.invalidate({ workOrderId }),
      ]);
    },
    onError: (error) => {
      toast.error(`Erro ao adicionar checklist: ${error.message}`);
    },
  });

  const { data: checklists, isLoading } = trpc.checklists.instances.listByTask.useQuery(
    { inspectionTaskId: task.id }
  );

  const { data: canComplete } = trpc.checklists.inspectionTasks.canComplete.useQuery(
    { id: task.id }
  );

  const aiSuggestMutation = trpc.checklists.instances.suggestConclusion.useMutation({
    onError: (e: any) => toast.error("Erro na sugestão de IA: " + e.message),
  });

  const isCompleted = task.status === "concluida";

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pendente":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendente</Badge>;
      case "em_andamento":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><AlertCircle className="h-3 w-3 mr-1" />Em Andamento</Badge>;
      case "concluida":
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Concluída</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleAddChecklist = () => {
    if (!selectedTemplateId || !customTitle.trim()) {
      toast.error("Selecione o tipo e preencha o título");
      return;
    }
    addChecklistMutation.mutate({
      inspectionTaskId: task.id,
      templateId: parseInt(selectedTemplateId),
      customTitle,
      brand: brand || undefined,
      power: power || undefined,
    });
  };

  return (
    <AccordionItem value={task.id.toString()} className="border rounded-lg">
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex items-center justify-between w-full pr-4">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="text-left">
              <h4 className="font-medium">{task.title}</h4>
              {task.description && (
                <p className="text-sm text-muted-foreground">{task.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {getStatusBadge(task.status)}
            <Badge variant="outline">
              {checklists?.length ?? 0} checklist(s)
            </Badge>
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Lista de checklists */}
            {checklists && checklists.length > 0 ? (
              <div className="space-y-3">
                {checklists.map((checklist) => {
                  const template = templates.find((t) => t.id === checklist.templateId) ?? null;

                  let formStructure = null;
                  if (template?.formStructure) {
                    try {
                      const parsed = JSON.parse(template.formStructure);
                      formStructure = parsed.fields && !parsed.sections
                        ? { sections: [{ id: "default", title: "Informações", fields: parsed.fields }] }
                        : parsed;
                    } catch (e) {
                      console.error("Erro ao fazer parse de formStructure:", e);
                    }
                  }

                  const responses = checklist.responses ? JSON.parse(checklist.responses) : {};

                  return (
                    <Card key={checklist.id}>
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{checklist.customTitle}</CardTitle>
                            <CardDescription className="text-xs">
                              {template?.name}
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
                                onClick={() => setEditingChecklistId(
                                  editingChecklistId === checklist.id ? null : checklist.id
                                )}
                                className="h-8 px-2 text-xs"
                              >
                                {editingChecklistId === checklist.id ? (
                                  <><X className="h-3 w-3 mr-1" />Cancelar</>
                                ) : (
                                  <><Edit2 className="h-3 w-3 mr-1" />Editar</>
                                )}
                              </Button>
                            )}
                            {!isCompleted && (
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
                                    <Button
                                      onClick={() => onDeleteChecklist(checklist.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      disabled={deleteChecklistMutation.isPending}
                                    >
                                      {deleteChecklistMutation.isPending ? (
                                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Removendo...</>
                                      ) : "Remover"}
                                    </Button>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        {formStructure && (
                          <ChecklistForm
                            formStructure={formStructure}
                            initialResponses={responses}
                            onSave={(newResponses, isComplete) => {
                              onSaveResponses(checklist.id, newResponses, isComplete);
                              setEditingChecklistId(null);
                            }}
                            isSaving={isSavingResponses}
                            readOnly={isCompleted && editingChecklistId !== checklist.id}
                            checklistId={checklist.id}
                            onAiSuggest={(id) => aiSuggestMutation.mutateAsync({ checklistInstanceId: id })}
                          />
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum checklist adicionado ainda.
              </p>
            )}

            {/* ✅ Form de adicionar checklist em Dialog — resolve overflow/dropdown no mobile */}
            <Dialog
              open={showAddChecklistForm}
              onOpenChange={(open) => {
                if (!open) {
                  setShowAddChecklistForm(false);
                  setSelectedTemplateId("");
                  setCustomTitle("");
                  setBrand("");
                  setPower("");
                }
              }}
            >
              <DialogContent className="max-w-md w-full">
                <DialogHeader>
                  <DialogTitle>Adicionar Checklist</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  {/* ✅ select nativo — abre picker do sistema no celular, sem bug de overflow */}
                  <div className="space-y-2">
                    <Label htmlFor={`template-${task.id}`}>Tipo de Checklist *</Label>
                    <select
                      id={`template-${task.id}`}
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full h-11 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="" disabled>Selecione o tipo</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id.toString()}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`customTitle-${task.id}`}>Título Personalizado *</Label>
                    <Input
                      id={`customTitle-${task.id}`}
                      placeholder="Ex: Bomba de Recalque Bloco 1"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      className="h-11"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`brand-${task.id}`}>Marca (opcional)</Label>
                      <Input
                        id={`brand-${task.id}`}
                        placeholder="Ex: WEG"
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`power-${task.id}`}>Potência (opcional)</Label>
                      <Input
                        id={`power-${task.id}`}
                        placeholder="Ex: 5 CV"
                        value={power}
                        onChange={(e) => setPower(e.target.value)}
                        className="h-11"
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowAddChecklistForm(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleAddChecklist}
                    disabled={addChecklistMutation.isPending}
                  >
                    {addChecklistMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Adicionar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Botões de ação da tarefa */}
            {!isCompleted && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t">
                <div className="flex gap-2">
                  {/* ✅ FIX: botão só ABRE o form (não faz toggle), X dentro do form fecha */}
                  {!showAddChecklistForm && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddChecklistForm(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar Checklist
                    </Button>
                  )}

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="h-4 w-4 mr-1" />
                        Excluir Tarefa
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir Tarefa?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação não pode ser desfeita. A tarefa e todos os checklists serão removidos.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onDeleteTask(task.id)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                <Button
                  onClick={() => onCompleteTask(task.id)}
                  disabled={!canComplete}
                  size="sm"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Concluir Tarefa
                </Button>
              </div>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
