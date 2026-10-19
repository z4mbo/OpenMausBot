import { createRoot } from "react-dom/client";
import { MemberCall, MemberCallHost } from "../../src/components/origin-pages/CallPage";
import { initialState, StoreContext } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { setSessionToken } from "../../src/lib/origin-cloud/client";
import "../../src/styles.css";
const peer = new URLSearchParams(location.search).get("peer") === "b" ? "b" : "a";
applySkin("midnight");
setSessionToken(`fixture-peer-${peer}`);
const me = { _id: `fixturepeer${peer}`, name: `Peer ${peer.toUpperCase()}`, email: `${peer}@example.test` };
createRoot(document.getElementById("root")!).render(
  <StoreContext.Provider value={{
    state: initialState, dispatch: () => {}, flushBotPatches: async () => null,
    refreshInstances: async () => {}, refreshModels: async () => {},
  }}>
    <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
      <MemberCallHost />
      <MemberCall
        target={{ teamId: "fixturepeerteam", room: "fixturepeerroom" }}
        me={me} canJoin name="Real peer fixture" open={() => {}}
      />
    </main>
  </StoreContext.Provider>,
);
