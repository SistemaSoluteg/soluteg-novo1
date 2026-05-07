import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function RedirectToClientLogin() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/client/login"); }, []);
  return null;
}
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminProfile from "./pages/AdminProfile";
import InspectionReports from "./pages/InspectionReports";
import ClientLogin from "./pages/ClientLogin";
import ClientPortal from "./pages/ClientPortal";
import WaterTankMonitoring from "./pages/WaterTankMonitoring";
import AdminClients from "./pages/AdminClients";
import EditClient from "./pages/EditClient";
import AdminDocuments from "./pages/AdminDocuments";
import AdminManageDocuments from "./pages/AdminManageDocuments";
import AdminEditCustomLabel from "./pages/AdminEditCustomLabel";
import ClientProfile from "./pages/ClientProfile";
import AdminWorkOrders from "./pages/AdminWorkOrders";
import AdminCreateWorkOrderNew from "./pages/AdminCreateWorkOrderNew";
import AdminViewWorkOrder from "./pages/AdminViewWorkOrder";
import AdminWorkOrderDetail from "./pages/AdminWorkOrderDetail";
import AdminWorkOrderDashboard from "./pages/AdminWorkOrderDashboard";
import AdminWorkOrderKanban from "./pages/AdminWorkOrderKanban";
import AdminEditWorkOrder from "./pages/AdminEditWorkOrder";
import AdminMassMessage from "./pages/AdminMassMessage";
import ReportClientRegistration from "./pages/ReportClientRegistration";
import ReportInspectionVisit from "./pages/ReportInspectionVisit";
import ReportInspectionVisit2 from "./pages/ReportInspectionVisit2";
import AdminBudgets from "./pages/AdminBudgets";
import AdminBudgetDetail from "./pages/AdminBudgetDetail";
import BudgetApproval from "./pages/BudgetApproval";
import AdminTechnicians from "./pages/AdminTechnicians";
import AdminWaterTanks from "./pages/AdminWaterTanks";
import AdminWaterTankDashboard from "./pages/AdminWaterTankDashboard";
import TechnicianLogin from "./pages/TechnicianLogin";
import TechnicianPortal from "./pages/TechnicianPortal";
import TechnicianWorkOrderDetail from "./pages/TechnicianWorkOrderDetail";
import AdminLaudos from "./pages/AdminLaudos";
import AdminLaudoForm from "./pages/AdminLaudoForm";
import TecnicoLaudos from "./pages/TecnicoLaudos";
import TecnicoLaudoForm from "./pages/TecnicoLaudoForm";
import TechnicianOfflineStatus from "./pages/TechnicianOfflineStatus";
import TechnicianHowOfflineWorks from "./pages/TechnicianHowOfflineWorks";
import PdvLayout from "./components/pdv/PdvLayout";
import { useAutoSync } from "./hooks/useAutoSync";
import PdvDashboard from "./pages/pdv/PdvDashboard";
import PdvSales from "./pages/pdv/PdvSales";
import PdvProducts from "./pages/pdv/PdvProducts";
import PdvCategories from "./pages/pdv/PdvCategories";
import PdvHistoricoVendas from "./pages/pdv/PdvHistoricoVendas";
import PdvCustomers from "./pages/pdv/PdvCustomers";
import PdvCashFlow from "./pages/pdv/PdvCashFlow";
import PdvReports from "./pages/pdv/PdvReports";
import PdvImport from "./pages/pdv/PdvImport";
import PdvProductLabel from "./pages/pdv/PdvProductLabel";
import PdvBatchLabels from "./pages/pdv/PdvBatchLabels";

function PdvRoute({ component: Component }: { component: React.ComponentType }) {
  return <PdvLayout><Component /></PdvLayout>;
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={RedirectToClientLogin} />
      <Route path={"/gestor/login"} component={AdminLogin} />
      <Route path={"/gestor/dashboard"} component={AdminDashboard} />
        <Route path="/gestor/profile" component={AdminProfile} />
      <Route path="/gestor/relatorios" component={InspectionReports} />
      <Route path="/gestor/clientes" component={AdminClients} />
      <Route path="/gestor/mensagens" component={AdminMassMessage} />
      <Route path="/gestor/clientes/editar/:id" component={EditClient} />
      <Route path="/gestor/documentos/enviar" component={AdminDocuments} />
      <Route path="/gestor/documentos" component={AdminManageDocuments} />
      <Route path="/gestor/edit-custom-label" component={AdminEditCustomLabel} />
      <Route path="/gestor/work-orders" component={AdminWorkOrders} />
      <Route path="/gestor/work-orders/dashboard" component={AdminWorkOrderDashboard} />
      <Route path="/gestor/work-orders/kanban" component={AdminWorkOrderKanban} />
      <Route path="/gestor/work-orders/new" component={AdminCreateWorkOrderNew} />
      <Route path="/gestor/work-orders/:id" component={AdminWorkOrderDetail} />
      <Route path="/gestor/work-orders/:id/edit" component={AdminEditWorkOrder} />
      <Route path="/gestor/orcamentos" component={AdminBudgets} />
      <Route path="/gestor/orcamentos/novo" component={AdminBudgetDetail} />
      <Route path="/gestor/orcamentos/:id" component={AdminBudgetDetail} />
      <Route path="/orcamento/:token" component={BudgetApproval} />
      <Route path="/relatorios/cadastro-cliente" component={ReportClientRegistration} />
      <Route path="/relatorios/visita-inspecao" component={ReportInspectionVisit} />
      <Route path="/relatorios/visita-inspecao-2" component={ReportInspectionVisit2} />

      <Route path="/client/login" component={ClientLogin} />
      <Route path="/client/portal" component={ClientPortal} />
      <Route path="/client/water-tank" component={WaterTankMonitoring} />
      <Route path="/client/profile" component={ClientProfile} />
      <Route path="/gestor/tecnicos" component={AdminTechnicians} />
      <Route path="/gestor/sensores-agua" component={AdminWaterTanks} />
      <Route path="/gestor/sensores-agua/:id" component={AdminWaterTankDashboard} />
      <Route path="/gestor/laudos" component={AdminLaudos} />
      <Route path="/gestor/laudos/novo" component={AdminLaudoForm} />
      <Route path="/gestor/laudos/:id" component={AdminLaudoForm} />

      <Route path="/technician/login" component={TechnicianLogin} />
      <Route path="/technician/portal" component={TechnicianPortal} />
      <Route path="/technician/work-orders/:id" component={TechnicianWorkOrderDetail} />
      <Route path="/technician/laudos" component={TecnicoLaudos} />
      <Route path="/technician/laudos/novo" component={TecnicoLaudoForm} />
      <Route path="/technician/laudos/:id" component={TecnicoLaudoForm} />
      <Route path="/technician/offline-status" component={TechnicianOfflineStatus} />
      <Route path="/technician/como-funciona-offline" component={TechnicianHowOfflineWorks} />

      {/* PDV Routes */}
      <Route path="/pdv">{() => <PdvRoute component={PdvDashboard} />}</Route>
      <Route path="/pdv/vendas">{() => <PdvRoute component={PdvSales} />}</Route>
      <Route path="/pdv/produtos/etiqueta/:id">{() => <PdvRoute component={PdvProductLabel} />}</Route>
      <Route path="/pdv/produtos/etiquetas-lote">{() => <PdvRoute component={PdvBatchLabels} />}</Route>
      <Route path="/pdv/produtos">{() => <PdvRoute component={PdvProducts} />}</Route>
      <Route path="/pdv/categorias">{() => <PdvRoute component={PdvCategories} />}</Route>
      <Route path="/pdv/historico">{() => <PdvRoute component={PdvHistoricoVendas} />}</Route>
      <Route path="/pdv/clientes">{() => <PdvRoute component={PdvCustomers} />}</Route>
      <Route path="/pdv/caixa">{() => <PdvRoute component={PdvCashFlow} />}</Route>
      <Route path="/pdv/relatorios">{() => <PdvRoute component={PdvReports} />}</Route>
      <Route path="/pdv/importar">{() => <PdvRoute component={PdvImport} />}</Route>

      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Componente invisível que ativa o auto-sync global.
// Separado em componente próprio para isolar o hook de side-effects do App.
function GlobalAutoSync() {
  useAutoSync();
  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          {/* Auto-sync sempre ativo, independente da tela atual */}
          <GlobalAutoSync />
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
