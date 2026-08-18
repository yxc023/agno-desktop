# agno-chat

React component package for embedding AGNO AgentOS chat into any web/desktop app.

## Quick start

```tsx
import { ChatPanel } from "agno-chat";
import "agno-chat/styles.css";

function App() {
  return (
    <ChatPanel
      baseUrl="http://127.0.0.1:8000"
      agentId="my-agent"
      onError={(err) => console.error(err)}
    />
  );
}
```

## Props

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `baseUrl` | `string` | yes | — | AGNO server URL |
| `agentId` | `string` | no | — | Active agent ID |
| `agents` | `AgentSummary[]` | no | — | Static agent list |
| `auth` | `{ token?, headers? }` | no | — | Authentication |
| `theme` | `AgnoChatTheme` | no | — | CSS variable overrides |
| `showSessionList` | `boolean` | no | `true` | Show left sidebar |
| `showReasoning` | `boolean` | no | `true` | Show reasoning blocks |
| `showContextProgress` | `boolean` | no | `true` | Show context-window ring |
| `briefToolCalls` | `boolean` | no | `false` | Collapse tool calls |
| `hideReasoning` | `boolean` | no | `false` | Hide reasoning entirely |
| `autoScroll` | `boolean` | no | `true` | Auto-scroll on new messages |
| `userId` | `string` | no | — | User ID for session isolation |
| `onOpenExternalUrl` | `(url) => void` | no | — | Override URL handler |
| `onError` | `(err) => void` | no | — | Error callback |
| `onSessionChange` | `(id \| null) => void` | no | — | Session change callback |
| `onAgentsChange` | `(agents) => void` | no | — | Agent list update callback |
| `slots` | `ChatPanelSlots` | no | — | Sub-area overrides |

## Theming

Override CSS variables on `:root` or pass via `theme` prop:

```css
:root {
  --agno-accent: #7c3aed;
  --agno-accent-fg: white;
  --agno-radius: 0.625rem;
}
```

## Peer dependencies

- `react ^19.2.0`
- `react-dom ^19.2.0`

Tailwind v4 is not required — the package ships source CSS with `@source` directives so your compiler picks up classes automatically.
