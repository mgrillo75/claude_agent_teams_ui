import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TooltipProvider } from '@renderer/components/ui/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalWorkspaceBootstrap } from '@features/terminal-workspace/contracts';

const panelFixture = vi.hoisted(() => ({
  commandDockProps: [] as Array<Record<string, unknown>>,
  createWorkspaceKernel: vi.fn(),
  createWorkspaceWebSocketTransport: vi.fn(),
  kernels: [] as MockKernel[],
  requestUpdate: vi.fn(),
  screenProps: [] as Array<Record<string, unknown>>,
  scrollToLatestOutput: vi.fn(),
}));

vi.mock('@features/localization/renderer', () => ({
  useAppTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'terminalWorkspace.currentWorkingDirectory': 'Current working directory',
        'terminalWorkspace.openTerminalPlatformRepository':
          'Open terminal-platform repository',
        'terminalWorkspace.poweredByTerminalPlatform': 'powered by terminal-platform',
        'terminalWorkspace.shellDefaultDirectory': 'Shell default directory',
      };
      if (key === 'terminalWorkspace.gitBranchTitle') {
        return `Git branch: ${values?.branch ?? ''}`;
      }
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('@terminal-platform/design-tokens', () => ({
  terminalPlatformThemeManifests: [
    { displayName: 'Terminal Platform Dark', id: 'terminal-platform-default' },
    { displayName: 'Terminal Platform Light', id: 'terminal-platform-light' },
  ],
}));

vi.mock('@terminal-platform/workspace-adapter-websocket', () => ({
  createWorkspaceWebSocketTransport: (...args: unknown[]) =>
    panelFixture.createWorkspaceWebSocketTransport(...args),
}));

vi.mock('@terminal-platform/workspace-core', () => ({
  createWorkspaceKernel: (...args: unknown[]) => panelFixture.createWorkspaceKernel(...args),
  terminalPlatformTerminalFontScales: ['compact', 'default', 'large'],
}));

vi.mock('@terminal-platform/workspace-react', async () => {
  const ReactModule = await import('react');
  const React = ReactModule.default;

  const TerminalWorkspace = ({
    children,
    kernel,
  }: {
    children?: React.ReactNode;
    kernel: MockKernel;
  }): React.ReactElement =>
    React.createElement(
      'div',
      {
        'data-kernel-id': kernel.id,
        'data-testid': 'mock-terminal-workspace',
      },
      children
    );

  const TerminalScreen = React.forwardRef<HTMLDivElement, Record<string, unknown>>(
    (props, ref) => {
      const elementRef = React.useRef<HTMLDivElement | null>(null);
      const fallbackElementRef = React.useRef<HTMLDivElement | null>(null);
      if (!fallbackElementRef.current && typeof document !== 'undefined') {
        fallbackElementRef.current = document.createElement('div');
      }

      panelFixture.screenProps.push(props);

      React.useImperativeHandle(ref, () => {
        const element = elementRef.current ?? fallbackElementRef.current;
        if (!element) {
          throw new Error('Terminal screen test element was not created');
        }
        Object.assign(element, {
          requestUpdate: panelFixture.requestUpdate,
          scrollToLatestOutput: panelFixture.scrollToLatestOutput,
        });
        return element;
      });

      const metadata = props.commandPresentationMetadata;
      const serializedMetadata = JSON.stringify(Array.isArray(metadata) ? metadata : []);

      return React.createElement(
        'div',
        {
          'data-command-metadata': serializedMetadata,
          'data-prompt-label': String(props.terminalPromptLabel ?? ''),
          'data-testid': 'mock-terminal-screen',
          ref: elementRef,
        },
        serializedMetadata
      );
    }
  );
  TerminalScreen.displayName = 'MockTerminalScreen';

  const TerminalCommandDock = React.forwardRef<HTMLDivElement, Record<string, unknown>>(
    (props, ref) => {
      panelFixture.commandDockProps.push(props);
      return React.createElement('div', {
        'data-testid': 'mock-terminal-command-dock',
        ref,
      });
    }
  );
  TerminalCommandDock.displayName = 'MockTerminalCommandDock';

  return {
    TerminalCommandDock,
    TerminalScreen,
    TerminalWorkspace,
    resolveTerminalTopologyControlState: (snapshot: MockWorkspaceSnapshot) => snapshot.__controls,
    useWorkspaceSnapshot: (kernel: MockKernel) => kernel.__snapshot,
  };
});

import { TerminalWorkspacePanel } from '@features/terminal-workspace/renderer/ui/TerminalWorkspacePanel';

const TEAM_NAME = 'terminal-fixture-team';
const PROJECT_PATH =
  '/Users/belief/dev/projects/claude/.terminal-platform-sandbox/terminal-ui-smoke';
const TERMINAL_PLATFORM_REPOSITORY_URL = 'https://github.com/777genius/terminal-platform';

describe('terminal workspace panel fixture-e2e', () => {
  let host: HTMLDivElement;
  let root: Root;
  let getBootstrap: ReturnType<typeof vi.fn<() => Promise<TerminalWorkspaceBootstrap>>>;
  let stopTeamRuntime: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
  let nextSnapshot: MockWorkspaceSnapshot;
  let kernelCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      }
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    panelFixture.commandDockProps.length = 0;
    panelFixture.kernels.length = 0;
    panelFixture.screenProps.length = 0;
    window.localStorage.clear();

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    nextSnapshot = createWorkspaceSnapshot();
    getBootstrap = vi.fn().mockResolvedValue(createBootstrap());
    stopTeamRuntime = vi.fn().mockResolvedValue(undefined);
    openExternal = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        openExternal,
      },
    });

    panelFixture.createWorkspaceWebSocketTransport.mockImplementation((options: unknown) => ({
      kind: 'fixture-transport',
      options,
    }));
    panelFixture.createWorkspaceKernel.mockImplementation((options: unknown) => {
      const kernel = createMockKernel(`kernel-${(kernelCounter += 1)}`, nextSnapshot, options);
      panelFixture.kernels.push(kernel);
      return kernel;
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flushMicrotasks();
    });
    host.remove();
    document.body.innerHTML = '';
    window.localStorage.clear();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
  });

  it('bootstraps the local SDK contract without launching a real terminal runtime', async () => {
    window.localStorage.setItem(storageKey('theme'), 'terminal-platform-light');
    window.localStorage.setItem(storageKey('font-scale'), 'large');
    window.localStorage.setItem(storageKey('line-wrap'), 'true');
    window.localStorage.setItem(
      storageKey('command-history'),
      JSON.stringify([
        '   ',
        '(venv312) (base) belief@MacBook-Pro-belief terminal-ui-smoke % git status',
        '(env) C:\\Users\\belief\\project $ pnpm test',
        'echo clean',
      ])
    );

    await renderPanel();

    expect(getBootstrap).toHaveBeenCalledWith({
      projectPath: PROJECT_PATH,
      teamDisplayName: 'Terminal Fixture',
      teamName: TEAM_NAME,
    });
    expect(panelFixture.createWorkspaceWebSocketTransport).toHaveBeenCalledWith({
      controlUrl: 'ws://fixture-control',
      streamUrl: 'ws://fixture-stream',
    });
    expect(panelFixture.createWorkspaceKernel).toHaveBeenCalledWith(
      expect.objectContaining({
        commandHistoryLimit: 80,
        initialCommandHistoryEntries: ['git status', 'pnpm test', 'echo clean'],
        initialTerminalFontScale: 'large',
        initialTerminalLineWrap: true,
        initialThemeId: 'terminal-platform-light',
        transport: expect.objectContaining({ kind: 'fixture-transport' }),
      })
    );
    expect(currentKernel().bootstrap).toHaveBeenCalledOnce();
  });

  it('persists terminal display settings and command history from the workspace snapshot', async () => {
    nextSnapshot = createWorkspaceSnapshot({
      commandHistoryEntries: ['pnpm typecheck', 'git status'],
      fontScale: 'compact',
      lineWrap: true,
      themeId: 'terminal-platform-light',
    });

    await renderPanel();

    expect(window.localStorage.getItem(storageKey('theme'))).toBe('terminal-platform-light');
    expect(window.localStorage.getItem(storageKey('font-scale'))).toBe('compact');
    expect(window.localStorage.getItem(storageKey('line-wrap'))).toBe('true');
    expect(JSON.parse(window.localStorage.getItem(storageKey('command-history')) ?? '[]')).toEqual([
      'pnpm typecheck',
      'git status',
    ]);
  });

  it('shows cwd, git branch, prompt label, and powered-by GitHub link in the command area', async () => {
    await renderPanel();

    const workingDirectory = getRequiredElement('agent-team-terminal-working-directory');
    const screen = getRequiredElement('mock-terminal-screen');
    expect(workingDirectory.textContent).toContain(
      '~/dev/projects/claude/.terminal-platform-sandbox/terminal-ui-smoke'
    );
    expect(workingDirectory.textContent).toContain('main');
    expect(workingDirectory.textContent).toContain('powered by terminal-platform');
    expect(screen.getAttribute('data-prompt-label')).toBe(
      '~/dev/projects/claude/.terminal-platform-sandbox/terminal-ui-smoke'
    );

    await clickButton('Open terminal-platform repository');
    expect(openExternal).toHaveBeenCalledWith(TERMINAL_PLATFORM_REPOSITORY_URL);
  });

  it('auto-attaches the selected session and prewarms one hidden shell tab', async () => {
    await renderPanel();

    const kernel = currentKernel();
    expect(kernel.commands.setActiveSession).not.toHaveBeenCalled();
    expect(kernel.commands.attachSession).toHaveBeenCalledWith('session-1');
    expect(kernel.commands.dispatchMuxCommand).toHaveBeenCalledWith('session-1', {
      kind: 'new_tab',
      title: '__tp_prewarmed_shell__',
    });
    expect(kernel.commands.dispatchMuxCommand).toHaveBeenCalledWith('session-1', {
      kind: 'focus_tab',
      tab_id: 'tab-1',
    });
  });

  it('activates the prewarmed shell instantly when users create a new tab', async () => {
    nextSnapshot = createWorkspaceSnapshot({
      tabs: [
        createTab('tab-1', 'Terminal UI Smoke', 'pane-1'),
        createTab('tab-prewarmed', '__tp_prewarmed_shell__', 'pane-prewarmed'),
      ],
    });

    await renderPanel();
    const kernel = currentKernel();
    kernel.commands.dispatchMuxCommand.mockClear();
    kernel.commands.attachSession.mockClear();

    await clickButton('Create terminal tab');

    expect(kernel.commands.dispatchMuxCommand.mock.calls.map(([, command]) => command)).toEqual([
      {
        kind: 'rename_tab',
        tab_id: 'tab-prewarmed',
        title: 'Tab 2',
      },
      {
        kind: 'focus_tab',
        tab_id: 'tab-prewarmed',
      },
    ]);
    expect(kernel.commands.attachSession).toHaveBeenCalledWith('session-1');
  });

  it('falls back to creating a cold tab when prewarm/focus support is unavailable', async () => {
    nextSnapshot = createWorkspaceSnapshot({
      controls: {
        canFocusTab: false,
      },
    });

    await renderPanel();
    const kernel = currentKernel();
    kernel.commands.dispatchMuxCommand.mockClear();

    await clickButton('Create terminal tab');

    expect(kernel.commands.dispatchMuxCommand).toHaveBeenCalledWith('session-1', {
      kind: 'new_tab',
      title: 'Tab 2',
    });
  });

  it('supports double-click tab rename and dispatches the mux rename command', async () => {
    nextSnapshot = createWorkspaceSnapshot({
      tabs: [
        createTab('tab-1', 'Terminal UI Smoke', 'pane-1'),
        createTab('tab-prewarmed', '__tp_prewarmed_shell__', 'pane-prewarmed'),
      ],
    });

    await renderPanel();
    const kernel = currentKernel();
    kernel.commands.dispatchMuxCommand.mockClear();

    const tabButton = getTabButton('Terminal UI Smoke');
    await act(async () => {
      tabButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    const input = getRequiredElement(
      'agent-team-terminal-tab-title-input'
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'Logs');
      await flushMicrotasks();
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
        })
      );
      await flushMicrotasks();
    });

    expect(kernel.commands.dispatchMuxCommand).toHaveBeenCalledWith('session-1', {
      kind: 'rename_tab',
      tab_id: 'tab-1',
      title: 'Logs',
    });
  });

  it('closes empty tabs immediately and asks for confirmation before dropping tab history', async () => {
    nextSnapshot = createWorkspaceSnapshot({
      historicalPanes: {
        'pane-2': {
          lines: ['old command output'],
        },
      },
      tabs: [
        createTab('tab-1', 'Terminal UI Smoke', 'pane-1'),
        createTab('tab-2', 'Logs', 'pane-2'),
        createTab('tab-prewarmed', '__tp_prewarmed_shell__', 'pane-prewarmed'),
      ],
    });

    await renderPanel();
    const kernel = currentKernel();
    kernel.commands.dispatchMuxCommand.mockClear();

    await clickButton('Close terminal tab Logs');
    expect(kernel.commands.dispatchMuxCommand).not.toHaveBeenCalledWith('session-1', {
      kind: 'close_tab',
      tab_id: 'tab-2',
    });
    expect(document.body.textContent).toContain('Close terminal tab?');

    await clickTextButton('Close tab');
    expect(kernel.commands.dispatchMuxCommand).toHaveBeenCalledWith('session-1', {
      kind: 'close_tab',
      tab_id: 'tab-2',
    });

    kernel.commands.dispatchMuxCommand.mockClear();
    await clickButton('Close terminal tab Terminal UI Smoke');
    expect(kernel.commands.dispatchMuxCommand).toHaveBeenCalledWith('session-1', {
      kind: 'close_tab',
      tab_id: 'tab-1',
    });
  });

  it('restores user tab order preferences and strips the hidden prewarmed tab from visible UI', async () => {
    window.localStorage.setItem(
      storageKey('tab-preferences'),
      JSON.stringify({
        colors: {},
        order: ['tab-2', 'tab-1', 'tab-prewarmed'],
        version: 1,
      })
    );
    nextSnapshot = createWorkspaceSnapshot({
      tabs: [
        createTab('tab-1', 'Terminal UI Smoke', 'pane-1'),
        createTab('tab-2', 'Logs', 'pane-2'),
        createTab('tab-prewarmed', '__tp_prewarmed_shell__', 'pane-prewarmed'),
      ],
    });

    await renderPanel();

    expect(getVisibleTabLabels()).toEqual(['Logs', 'Terminal UI Smoke']);
    expect(document.body.textContent).not.toContain('__tp_prewarmed_shell__');
  });

  it('forwards command lifecycle metadata into terminal screen presentations and scrolls down', async () => {
    nextSnapshot = createWorkspaceSnapshot({
      tabs: [
        createTab('tab-1', 'Terminal UI Smoke', 'pane-1'),
        createTab('tab-prewarmed', '__tp_prewarmed_shell__', 'pane-prewarmed'),
      ],
    });
    await renderPanel();

    const dock = getRequiredElement('mock-terminal-command-dock');
    await act(async () => {
      dock.dispatchEvent(
        new CustomEvent('tp-terminal-command-submitted', {
          bubbles: true,
          detail: {
            clientEventId: 'command-1',
            command: 'git status',
            paneId: 'pane-1',
            sessionId: 'session-1',
            startedAtMs: 1000,
          },
        })
      );
      await flushMicrotasks();
    });

    let metadata = getLatestScreenCommandMetadata();
    expect(metadata).toEqual([
      expect.objectContaining({
        clientEventId: 'command-1',
        command: 'git status',
        status: 'running',
      }),
    ]);
    expect(panelFixture.scrollToLatestOutput).toHaveBeenCalled();

    await act(async () => {
      dock.dispatchEvent(
        new CustomEvent('tp-terminal-command-failed', {
          bubbles: true,
          detail: {
            clientEventId: 'command-1',
            command: 'git status',
            paneId: 'pane-1',
            sessionId: 'session-1',
            startedAtMs: Date.now() - 230,
          },
        })
      );
      await flushMicrotasks();
    });

    metadata = getLatestScreenCommandMetadata();
    expect(metadata[0]).toMatchObject({
      clientEventId: 'command-1',
      command: 'git status',
      status: 'failed',
    });
    expect(metadata[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('settles completed shell output with duration and failure state in the rendered screen metadata', async () => {
    const tabs = [
      createTab('tab-1', 'Terminal UI Smoke', 'pane-1'),
      createTab('tab-prewarmed', '__tp_prewarmed_shell__', 'pane-prewarmed'),
    ];
    nextSnapshot = createWorkspaceSnapshot({
      tabs,
    });
    await renderPanel();

    const dock = getRequiredElement('mock-terminal-command-dock');
    await act(async () => {
      dock.dispatchEvent(
        new CustomEvent('tp-terminal-command-started', {
          bubbles: true,
          detail: {
            clientEventId: 'command-2',
            command: 'git status',
            paneId: 'pane-1',
            sessionId: 'session-1',
            startedAtMs: Date.now() - 294,
          },
        })
      );
      await flushMicrotasks();
    });

    currentKernel().__snapshot = createWorkspaceSnapshot({
      focusedLines: [
        { text: 'shell % git status' },
        { text: 'fatal: not a git repository (or any of the parent directories): .git' },
        { text: 'shell %' },
      ],
      sequence: 42,
      tabs,
    });
    await renderPanel();

    const metadata = getLatestScreenCommandMetadata();
    expect(metadata[0]).toMatchObject({
      clientEventId: 'command-2',
      command: 'git status',
      status: 'failed',
    });
    expect(metadata[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('routes settings controls into kernel commands and runtime actions', async () => {
    await renderPanel({ settingsOpen: true });
    const kernel = currentKernel();

    await clickTextButton('Light');
    await clickTextButton('Large');
    await clickTextButton('Wrap');
    await clickButton('Reconnect terminal workspace');
    await clickButton('Reload terminal sessions');
    await clickButton('Stop terminal runtime');

    expect(kernel.commands.setTheme).toHaveBeenCalledWith('terminal-platform-light');
    expect(kernel.commands.setTerminalFontScale).toHaveBeenCalledWith('large');
    expect(kernel.commands.setTerminalLineWrap).toHaveBeenCalledWith(true);
    expect(kernel.commands.bootstrap).toHaveBeenCalled();
    expect(kernel.commands.refreshSessions).toHaveBeenCalled();
    expect(stopTeamRuntime).toHaveBeenCalledWith(TEAM_NAME);
  });

  it('renders bootstrap failures without constructing a workspace kernel', async () => {
    getBootstrap.mockRejectedValueOnce(new Error('sandbox terminal runtime unavailable'));

    await renderPanel();

    expect(document.body.textContent).toContain('Terminal runtime is unavailable');
    expect(document.body.textContent).toContain('sandbox terminal runtime unavailable');
    expect(panelFixture.createWorkspaceKernel).not.toHaveBeenCalled();
  });

  it('disposes the kernel when the panel unmounts', async () => {
    await renderPanel();
    const kernel = currentKernel();

    await act(async () => {
      root.unmount();
      await flushMicrotasks();
    });

    expect(kernel.dispose).toHaveBeenCalledOnce();
  });

  async function renderPanel({
    settingsOpen = false,
  }: {
    settingsOpen?: boolean;
  } = {}): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(
          TooltipProvider,
          null,
          React.createElement(TerminalWorkspacePanel, {
            getBootstrap,
            gitBranch: 'main',
            isTeamAlive: true,
            projectPath: PROJECT_PATH,
            settingsOpen,
            stopTeamRuntime,
            surface: 'sheet',
            teamDisplayName: 'Terminal Fixture',
            teamName: TEAM_NAME,
          })
        )
      );
      await flushMicrotasks();
    });
  }
});

interface MockKernel {
  __options: unknown;
  __snapshot: MockWorkspaceSnapshot;
  bootstrap: ReturnType<typeof vi.fn<() => Promise<void>>>;
  commands: {
    attachSession: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>;
    bootstrap: ReturnType<typeof vi.fn<() => Promise<void>>>;
    dispatchMuxCommand: ReturnType<
      typeof vi.fn<(sessionId: string, command: MockMuxCommand) => Promise<void>>
    >;
    refreshSessions: ReturnType<typeof vi.fn<() => Promise<void>>>;
    setActiveSession: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
    setTerminalFontScale: ReturnType<typeof vi.fn<(fontScale: string) => void>>;
    setTerminalLineWrap: ReturnType<typeof vi.fn<(lineWrap: boolean) => void>>;
    setTheme: ReturnType<typeof vi.fn<(themeId: string) => void>>;
  };
  dispose: ReturnType<typeof vi.fn<() => Promise<void>>>;
  id: string;
}

interface MockWorkspaceSnapshot {
  __controls: MockTopologyControls;
  attachedSession: {
    focused_screen: {
      pane_id: string;
      sequence: number;
      surface: {
        lines: Array<{ text: string }>;
      };
    };
    session_id: string;
    topology: {
      focused_tab: string;
      tabs: MockTab[];
    };
  };
  catalog: {
    sessions: Array<{ session_id: string; title: string }>;
  };
  commandHistory: {
    entries: string[];
  };
  connection: {
    state: 'ready' | 'connecting' | 'closed';
  };
  historicalPanes: Record<string, { lines: string[] }>;
  selection: {
    activeSessionId: string | null;
  };
  terminalDisplay: {
    fontScale: string;
    lineWrap: boolean;
  };
  theme: {
    themeId: string;
  };
}

interface MockTopologyControls {
  activeSessionId: string;
  activeTab: MockTab | null;
  canCloseTab: boolean;
  canCreateTab: boolean;
  canFocusTab: boolean;
  canRenameTab: boolean;
}

interface MockTab {
  root: {
    kind: 'leaf';
    pane_id: string;
  };
  tab_id: string;
  title: string;
}

type MockMuxCommand =
  | {
      kind: 'close_tab' | 'focus_tab';
      tab_id: string;
    }
  | {
      kind: 'new_tab';
      title: string;
    }
  | {
      kind: 'rename_tab';
      tab_id: string;
      title: string;
    };

function createBootstrap(): TerminalWorkspaceBootstrap {
  return {
    controlPlaneUrl: 'ws://fixture-control',
    defaultShell: '/bin/zsh',
    projectPath: PROJECT_PATH,
    runtimeSlug: 'terminal-fixture-runtime',
    sessionStreamUrl: 'ws://fixture-stream',
    teamName: TEAM_NAME,
  };
}

function createMockKernel(
  id: string,
  snapshot: MockWorkspaceSnapshot,
  options: unknown
): MockKernel {
  return {
    __options: options,
    __snapshot: snapshot,
    bootstrap: vi.fn().mockResolvedValue(undefined),
    commands: {
      attachSession: vi.fn().mockResolvedValue(undefined),
      bootstrap: vi.fn().mockResolvedValue(undefined),
      dispatchMuxCommand: vi.fn().mockResolvedValue(undefined),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
      setActiveSession: vi.fn(),
      setTerminalFontScale: vi.fn(),
      setTerminalLineWrap: vi.fn(),
      setTheme: vi.fn(),
    },
    dispose: vi.fn().mockResolvedValue(undefined),
    id,
  };
}

function createWorkspaceSnapshot({
  commandHistoryEntries = [],
  connectionState = 'ready',
  controls = {},
  focusedTabId = 'tab-1',
  fontScale = 'default',
  focusedLines = [],
  historicalPanes = {},
  lineWrap = false,
  sequence = 1,
  tabs = [createTab('tab-1', 'Terminal UI Smoke', 'pane-1')],
  themeId = 'terminal-platform-default',
}: {
  commandHistoryEntries?: string[];
  connectionState?: MockWorkspaceSnapshot['connection']['state'];
  controls?: Partial<
    Omit<MockTopologyControls, 'activeSessionId' | 'activeTab'> & {
      activeSessionId: string;
      activeTab: MockTab | null;
    }
  >;
  focusedTabId?: string;
  fontScale?: string;
  focusedLines?: Array<{ text: string }>;
  historicalPanes?: Record<string, { lines: string[] }>;
  lineWrap?: boolean;
  sequence?: number;
  tabs?: MockTab[];
  themeId?: string;
} = {}): MockWorkspaceSnapshot {
  const activeTab = tabs.find((tab) => tab.tab_id === focusedTabId) ?? tabs[0] ?? null;
  const activePaneId = activeTab?.root.pane_id ?? 'pane-1';
  const activeSessionId = controls.activeSessionId ?? 'session-1';

  return {
    __controls: {
      activeSessionId,
      activeTab,
      canCloseTab: controls.canCloseTab ?? true,
      canCreateTab: controls.canCreateTab ?? true,
      canFocusTab: controls.canFocusTab ?? true,
      canRenameTab: controls.canRenameTab ?? true,
    },
    attachedSession: {
      focused_screen: {
        pane_id: activePaneId,
        sequence,
        surface: {
          lines: focusedLines,
        },
      },
      session_id: activeSessionId,
      topology: {
        focused_tab: activeTab?.tab_id ?? focusedTabId,
        tabs,
      },
    },
    catalog: {
      sessions: [{ session_id: activeSessionId, title: 'Fixture Session' }],
    },
    commandHistory: {
      entries: commandHistoryEntries,
    },
    connection: {
      state: connectionState,
    },
    historicalPanes,
    selection: {
      activeSessionId,
    },
    terminalDisplay: {
      fontScale,
      lineWrap,
    },
    theme: {
      themeId,
    },
  };
}

function createTab(tabId: string, title: string, paneId: string): MockTab {
  return {
    root: {
      kind: 'leaf',
      pane_id: paneId,
    },
    tab_id: tabId,
    title,
  };
}

function storageKey(key: string): string {
  return `agent-teams:terminal-workspace:${TEAM_NAME}:${key}`;
}

function currentKernel(): MockKernel {
  const kernel = panelFixture.kernels.at(-1);
  if (!kernel) {
    throw new Error('Expected a workspace kernel to be created');
  }
  return kernel;
}

function getRequiredElement(testId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`Missing test element: ${testId}`);
  }
  return element;
}

function getVisibleTabLabels(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-testid="agent-team-terminal-mux-tab"]')
  ).map((button) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

function getTabButton(label: string): HTMLButtonElement {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-testid="agent-team-terminal-mux-tab"]')
  ).find((candidate) => candidate.textContent?.includes(label));
  if (!button) {
    throw new Error(`Missing tab button: ${label}`);
  }
  return button;
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === label
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushMicrotasks();
  });
}

async function clickTextButton(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Missing text button: ${text}`);
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushMicrotasks();
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
}

function getLatestScreenCommandMetadata(): Array<Record<string, unknown>> {
  const raw = getRequiredElement('mock-terminal-screen').getAttribute('data-command-metadata');
  return JSON.parse(raw ?? '[]') as Array<Record<string, unknown>>;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
