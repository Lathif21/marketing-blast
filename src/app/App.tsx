import { useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { CampaignBuilderScreen } from "./screens/CampaignBuilderScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { SuppressionScreen } from "./screens/SuppressionScreen";
import type { Screen } from "./lib/types";

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");

  return (
    <div
      className="flex h-screen overflow-hidden bg-background text-foreground"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui" }}
    >
      <Sidebar screen={screen} onNavigate={setScreen} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header screen={screen} />
        <main
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(100,140,180,0.18) transparent" }}
        >
          {screen === "dashboard" && <DashboardScreen onNavigate={setScreen} />}
          {screen === "import" && <ImportScreen />}
          {screen === "contacts" && <ContactsScreen />}
          {screen === "builder" && <CampaignBuilderScreen />}
          {screen === "report" && <ReportScreen />}
          {screen === "suppression" && <SuppressionScreen />}
        </main>
      </div>
    </div>
  );
}
