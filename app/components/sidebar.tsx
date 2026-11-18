import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";

import styles from "./home.module.scss";

import GithubIcon from "../icons/github.svg";
import NextChatIcon from "../icons/logo.svg";
import DragIcon from "../icons/drag.svg";
import {
  LoginLine,
  MaskLine,
  NewChatLine,
  SearchLine,
  SettingsLine,
  SidebarLine,
  ToolLine,
} from "./line-icons";

import Locale from "../locales";

import { useAccessStore, useAppConfig, useChatStore } from "../store";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NARROW_SIDEBAR_WIDTH,
  Path,
  REPO_URL,
} from "../constant";

import { useNavigate } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { isMcpEnabled } from "../mcp/actions";
import { FEATURES, SITE_NAME } from "../config/site";
import { needsLogin, startLogin } from "../utils/login";

// entries that only exist when their feature is switched on
const EXTRA_ENTRIES = [
  ...(FEATURES.plugins
    ? [{ name: Locale.Plugin.Name, path: Path.Plugins }]
    : []),
  ...(FEATURES.sd ? [{ name: "Stable Diffusion", path: Path.Sd }] : []),
];

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => null,
});

export function useHotKey() {
  const chatStore = useChatStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (e.key === "ArrowUp") {
          chatStore.nextSession(-1);
        } else if (e.key === "ArrowDown") {
          chatStore.nextSession(1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

// Widths of this layout. The store keeps upstream's numbers: its default
// width stands for ours, anything below the minimum means "collapsed".
const SIDEBAR_WIDTH = 260;
const RAIL_WIDTH = 56;
const sidebarWidthOf = (stored?: number) =>
  !stored || stored === DEFAULT_SIDEBAR_WIDTH ? SIDEBAR_WIDTH : stored;

export function useDragSideBar() {
  const limit = (x: number) => Math.min(MAX_SIDEBAR_WIDTH, x);

  const config = useAppConfig();
  const startX = useRef(0);
  const startDragWidth = useRef(config.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const lastUpdateTime = useRef(Date.now());

  const toggleSideBar = () => {
    config.update((config) => {
      if (config.sidebarWidth < MIN_SIDEBAR_WIDTH) {
        config.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      } else {
        config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
      }
    });
  };

  const onDragStart = (e: MouseEvent) => {
    // Remembers the initial width each time the mouse is pressed
    startX.current = e.clientX;
    startDragWidth.current = sidebarWidthOf(config.sidebarWidth);
    const dragStartTime = Date.now();

    const handleDragMove = (e: MouseEvent) => {
      if (Date.now() < lastUpdateTime.current + 20) {
        return;
      }
      lastUpdateTime.current = Date.now();
      const d = e.clientX - startX.current;
      const nextWidth = limit(startDragWidth.current + d);
      config.update((config) => {
        if (nextWidth < MIN_SIDEBAR_WIDTH) {
          config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
        } else {
          config.sidebarWidth = nextWidth;
        }
      });
    };

    const handleDragEnd = () => {
      // In useRef the data is non-responsive, so `config.sidebarWidth` can't get the dynamic sidebarWidth
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);

      // if user click the drag icon, should toggle the sidebar
      const shouldFireClick = Date.now() - dragStartTime < 300;
      if (shouldFireClick) {
        toggleSideBar();
      }
    };

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  };

  const isMobileScreen = useMobileScreen();
  const shouldNarrow =
    !isMobileScreen && config.sidebarWidth < MIN_SIDEBAR_WIDTH;

  useEffect(() => {
    const barWidth = shouldNarrow
      ? RAIL_WIDTH
      : limit(sidebarWidthOf(config.sidebarWidth));
    const sideBarWidth = isMobileScreen ? "100vw" : `${barWidth}px`;
    document.documentElement.style.setProperty("--sidebar-width", sideBarWidth);
  }, [config.sidebarWidth, isMobileScreen, shouldNarrow]);

  return {
    onDragStart,
    shouldNarrow,
    toggleSideBar,
  };
}

/**
 * Open an empty chat. An untouched empty session is reused, so that pressing
 * the entry repeatedly does not pile up blank chats.
 */
export function useStartNewChat() {
  const navigate = useNavigate();
  return () => {
    const chatStore = useChatStore.getState();
    const latest = chatStore.sessions[0];
    const isBlank =
      !!latest &&
      latest.messages.length === 0 &&
      latest.mask.context.length === 0;
    if (isBlank) {
      chatStore.selectSession(0);
    } else {
      chatStore.newSession();
    }
    navigate(Path.Chat);
  };
}

export function SideBarContainer(props: {
  children: React.ReactNode;
  onDragStart: (e: MouseEvent) => void;
  shouldNarrow: boolean;
  className?: string;
}) {
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );
  const { children, className, onDragStart, shouldNarrow } = props;
  return (
    <div
      className={clsx(styles.sidebar, className, {
        [styles["narrow-sidebar"]]: shouldNarrow,
      })}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      {children}
      <div
        className={styles["sidebar-drag"]}
        onPointerDown={(e) => onDragStart(e as any)}
      >
        <DragIcon />
      </div>
    </div>
  );
}

export function SideBarHeader(props: {
  title?: string | React.ReactNode;
  subTitle?: string | React.ReactNode;
  logo?: React.ReactNode;
  children?: React.ReactNode;
  shouldNarrow?: boolean;
}) {
  const { title, subTitle, logo, children, shouldNarrow } = props;
  return (
    <Fragment>
      <div
        className={clsx(styles["sidebar-header"], {
          [styles["sidebar-header-narrow"]]: shouldNarrow,
        })}
        data-tauri-drag-region
      >
        <div className={styles["sidebar-title-container"]}>
          <div className={styles["sidebar-title"]} data-tauri-drag-region>
            {title}
          </div>
          <div className={styles["sidebar-sub-title"]}>{subTitle}</div>
        </div>
        <div className={clsx(styles["sidebar-logo"], "no-dark")}>{logo}</div>
      </div>
      {children}
    </Fragment>
  );
}

export function SideBarBody(props: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}) {
  const { onClick, children } = props;
  return (
    <div className={styles["sidebar-body"]} onClick={onClick}>
      {children}
    </div>
  );
}

export function SideBarTail(props: {
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  const { primaryAction, secondaryAction } = props;

  return (
    <div className={styles["sidebar-tail"]}>
      <div className={styles["sidebar-actions"]}>{primaryAction}</div>
      <div className={styles["sidebar-actions"]}>{secondaryAction}</div>
    </div>
  );
}

export function SideBar(props: { className?: string }) {
  useHotKey();
  const { onDragStart, shouldNarrow, toggleSideBar } = useDragSideBar();
  const navigate = useNavigate();
  const config = useAppConfig();
  const startNewChat = useStartNewChat();
  const [mcpEnabled, setMcpEnabled] = useState(false);

  useEffect(() => {
    // 检查 MCP 是否启用
    const checkMcpStatus = async () => {
      const enabled = FEATURES.mcp && (await isMcpEnabled());
      setMcpEnabled(enabled);
    };
    checkMcpStatus();
  }, []);

  const showLogin = useAccessStore((state) => needsLogin(state));

  const fromHome = { state: { fromHome: true } };
  const openSearch = () => navigate(Path.SearchChat, fromHome);

  return (
    <SideBarContainer
      onDragStart={onDragStart}
      shouldNarrow={shouldNarrow}
      {...props}
    >
      <div className={styles["side-top"]} data-tauri-drag-region>
        <div className={clsx(styles["side-brand"], "no-dark")}>
          <NextChatIcon />
          <span>{SITE_NAME}</span>
        </div>
        <button
          className={clsx(
            styles["side-icon-button"],
            styles["side-hide-narrow"],
          )}
          title={Locale.SearchChat.Page.Title}
          aria-label={Locale.SearchChat.Page.Title}
          onClick={openSearch}
        >
          <SearchLine />
        </button>
        <button
          className={clsx(styles["side-icon-button"], styles["side-toggle"])}
          title={Locale.Home.ToggleSidebar}
          aria-label={Locale.Home.ToggleSidebar}
          aria-expanded={!shouldNarrow}
          data-testid="sidebar-toggle"
          onClick={toggleSideBar}
        >
          <SidebarLine />
        </button>
      </div>

      <nav className={styles["side-nav"]}>
        <button
          className={styles["side-row"]}
          title={Locale.Home.NewChat}
          data-testid="new-chat"
          onClick={startNewChat}
        >
          <NewChatLine />
          <span>{Locale.Home.NewChat}</span>
        </button>
        <button
          className={clsx(styles["side-row"], styles["side-row-narrow-only"])}
          title={Locale.SearchChat.Page.Title}
          onClick={openSearch}
        >
          <SearchLine />
          <span>{Locale.SearchChat.Page.Title}</span>
        </button>
        <button
          className={styles["side-row"]}
          title={Locale.Mask.Name}
          onClick={() => {
            if (config.dontShowMaskSplashScreen !== true) {
              navigate(Path.NewChat, fromHome);
            } else {
              navigate(Path.Masks, fromHome);
            }
          }}
        >
          <MaskLine />
          <span>{Locale.Mask.Name}</span>
        </button>
        {mcpEnabled && (
          <button
            className={styles["side-row"]}
            title={Locale.Mcp.Name}
            onClick={() => navigate(Path.McpMarket, fromHome)}
          >
            <ToolLine />
            <span>{Locale.Mcp.Name}</span>
          </button>
        )}
        {EXTRA_ENTRIES.map((item) => (
          <button
            key={item.path}
            className={styles["side-row"]}
            title={item.name}
            onClick={() => navigate(item.path, fromHome)}
          >
            <ToolLine />
            <span>{item.name}</span>
          </button>
        ))}
      </nav>

      {shouldNarrow ? (
        <div className={styles["side-spacer"]} />
      ) : (
        <>
          <div className={styles["side-label"]}>{Locale.Home.Recents}</div>
          <SideBarBody
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                navigate(Path.Home);
              }
            }}
          >
            <ChatList />
          </SideBarBody>
        </>
      )}

      <div className={styles["side-foot"]}>
        {showLogin && (
          <button
            className={styles["side-row"]}
            title={Locale.Login.Action}
            data-testid="sidebar-login"
            onClick={() => startLogin(useAccessStore.getState())}
          >
            <LoginLine />
            <span>{Locale.Login.Action}</span>
          </button>
        )}
        <button
          className={styles["side-row"]}
          title={Locale.Settings.Title}
          onClick={() => navigate(Path.Settings)}
        >
          <SettingsLine />
          <span>{Locale.Settings.Title}</span>
        </button>
        {FEATURES.upstreamLinks && (
          <a
            className={clsx(styles["side-row"], "no-dark")}
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon />
            <span>GitHub</span>
          </a>
        )}
      </div>
    </SideBarContainer>
  );
}
