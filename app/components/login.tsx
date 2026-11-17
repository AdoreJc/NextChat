import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";

import styles from "./auth.module.scss";
import { IconButton } from "./button";
import BotIcon from "../icons/nextchat-bot.svg";
import Locale from "../locales";
import { Path } from "../constant";
import { useAccessStore } from "../store";
import {
  completeLogin,
  isLoginEnabled,
  LoginFailure,
  startLogin,
  takeAuthCallback,
} from "../utils/login";

/** key as the old link import stores it; the endpoint setting is not touched */
function saveLoginKey(key: string) {
  useAccessStore.getState().update((access) => {
    access.openaiApiKey = key;
    access.useCustomConfig = true;
  });
}

function LoginShell(props: {
  title: string;
  tips?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles["auth-page"]}>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <BotIcon />
      </div>
      <div className={styles["auth-title"]}>{props.title}</div>
      {props.tips && <div className={styles["auth-tips"]}>{props.tips}</div>}
      {props.children && (
        <div className={styles["auth-actions"]} style={{ marginTop: "3vh" }}>
          {props.children}
        </div>
      )}
    </div>
  );
}

/** `#/login`: leave for the authorize page, or go on to the chat with a key */
export function LoginPage() {
  const navigate = useNavigate();
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // the login url comes with the server config, wait for it
    useAccessStore
      .getState()
      .whenConfigLoaded()
      .then(() => {
        if (cancelled) return;
        const access = useAccessStore.getState();
        if (access.openaiApiKey) {
          navigate(Path.Chat, { replace: true });
        } else if (!startLogin(access, { replace: true })) {
          setNotConfigured(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (notConfigured) {
    return (
      <LoginShell title={Locale.Login.NotConfigured}>
        <IconButton
          text={Locale.Login.BackToChat}
          type="primary"
          onClick={() => navigate(Path.Chat, { replace: true })}
        />
      </LoginShell>
    );
  }

  return <LoginShell title={Locale.Login.Redirecting} />;
}

const NO_CALLBACK = { key: "", state: "", error: "" };

/** `#/auth-callback`: the API site sent the browser back */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const handled = useRef(false);
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  // the login url may arrive with the server config after this page shows
  const canRetry = useAccessStore((state) => isLoginEnabled(state));

  useEffect(() => {
    const params = takeAuthCallback();
    if (params === "dropped") {
      // parameters put into the address of the running page: not a callback.
      // The pending state is used up and the page starts over without them.
      completeLogin(NO_CALLBACK, { saveKey: () => {} });
      window.location.reload();
      return;
    }
    if (!params) {
      // opened without parameters; nothing was asked for
      if (!handled.current) {
        completeLogin(NO_CALLBACK, { saveKey: () => {} });
        setFailure("state_mismatch");
      }
      return;
    }
    handled.current = true;

    // the key goes into the stored state, which has to be loaded first
    useAccessStore
      .getState()
      .whenHydrated()
      .then(() => {
        const result = completeLogin(params, { saveKey: saveLoginKey });
        if (result.ok) {
          navigate(Path.Chat, { replace: true });
        } else {
          setFailure(result.reason);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  if (!failure) {
    return <LoginShell title={Locale.Login.Processing} />;
  }

  return (
    <LoginShell title={Locale.Login.Failed} tips={Locale.Login.Errors[failure]}>
      {canRetry && (
        <IconButton
          text={Locale.Login.Retry}
          type="primary"
          onClick={() => startLogin(useAccessStore.getState())}
        />
      )}
      <IconButton
        text={Locale.Login.BackToChat}
        onClick={() => navigate(Path.Chat, { replace: true })}
      />
    </LoginShell>
  );
}

/** notice with a sign-in button, shown under a chat message */
export function LoginNotice(props: { text?: string }) {
  return (
    <div className={styles["login-notice"]}>
      {props.text && <span>{props.text}</span>}
      <IconButton
        text={Locale.Login.Action}
        type="primary"
        onClick={() => startLogin(useAccessStore.getState())}
      />
    </div>
  );
}
