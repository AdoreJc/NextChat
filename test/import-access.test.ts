import { jest } from "@jest/globals";

// "Import local data" and cloud sync merge a state from outside into the
// stores of this browser. While the access config (endpoint, key) is managed
// by the sign-in, nothing from outside may change it. These tests run the
// real `syncStore.import()` / `syncStore.sync()` (only the file picker and the
// sync client are replaced) and look at what ends up in the browser storage.

const LOGIN_URL = "https://api.example.test/chat-authorize";
const API_ORIGIN = "https://api.example.test";
const ELSEWHERE = "https://elsewhere.example.test";
const TEST_KEY = "sk-test-0000000000000000";
const FILE_KEY = "sk-from-a-file-00000000";

type Stores = {
  useAccessStore: typeof import("../app/store/access").useAccessStore;
  useChatStore: typeof import("../app/store/chat").useChatStore;
  useAppConfig: typeof import("../app/store/config").useAppConfig;
  useSyncStore: typeof import("../app/store/sync").useSyncStore;
  getLocalAppState: typeof import("../app/utils/sync").getLocalAppState;
};
let stores: Stores;
let counter = 0;

/** what the persisted store holds in the browser storage */
function persisted(name: string) {
  return JSON.parse(localStorage.getItem(name) ?? "{}").state ?? {};
}

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("never happened: " + what);
}

const ACCESS_FIELDS = [
  "openaiApiKey",
  "openaiUrl",
  "useCustomConfig",
  "loginUrl",
  "loginAt",
] as const;
const pick = (state: Record<string, unknown>) =>
  Object.fromEntries(ACCESS_FIELDS.map((field) => [field, state[field]]));

/** a backup of this browser with other access settings, a chat and a setting */
function backupWith(access: Record<string, unknown>) {
  const id = `imported-session-${++counter}`;
  const fontSize = 20 + counter;
  const backup = JSON.parse(JSON.stringify(stores.getLocalAppState()));
  Object.assign(backup["access-control"], access, {
    lastUpdateTime: Date.now() + 60_000,
  });
  backup["chat-next-web-store"].sessions = [
    {
      ...backup["chat-next-web-store"].sessions[0],
      id,
      topic: "from the backup",
      messages: [
        {
          id: `m-${id}`,
          role: "user",
          content: "hello",
          date: new Date().toLocaleString(),
        },
      ],
    },
  ];
  backup["app-config"].fontSize = fontSize;
  return { text: JSON.stringify(backup), sessionId: id, fontSize };
}

/** the rest of the backup arrived, in the stores and in the storage */
async function expectOtherDataImported(backup: ReturnType<typeof backupWith>) {
  // the settings are written after the access config, so by now the access
  // config in the storage is final as well
  await until(
    () => persisted("app-config").fontSize === backup.fontSize,
    "imported setting in the storage",
  );
  expect(stores.useAppConfig.getState().fontSize).toBe(backup.fontSize);
  const inStore = stores.useChatStore
    .getState()
    .sessions.find((session) => session.id === backup.sessionId);
  expect(inStore?.messages).toHaveLength(1);
  expect(
    persisted("chat-next-web-store").sessions.some(
      (session: { id: string }) => session.id === backup.sessionId,
    ),
  ).toBe(true);
}

let pickedFile = "";
let reloads: jest.SpiedFunction<typeof console.error>;

/** the real import, with the given text as the picked file */
async function importFile(text: string) {
  pickedFile = text;
  reloads.mockClear();
  await stores.useSyncStore.getState().import();
  // the import ends with a page reload, which the test page reports
  expect(reloads).toHaveBeenCalled();
}

/** the real sync against a remote that holds the given state */
async function syncWith(text: string) {
  const uploaded: string[] = [];
  stores.useSyncStore.setState({
    getClient: () =>
      ({
        get: async () => text,
        set: async (_key: string, value: string) => void uploaded.push(value),
        check: async () => true,
      }) as any,
  } as any);
  await stores.useSyncStore.getState().sync();
  return uploaded;
}

async function setAccess(state: {
  loginUrl: string;
  signedIn: boolean;
  loginUrlAfterSignIn?: string;
}) {
  const { useAccessStore } = stores;
  useAccessStore.setState({ loginUrl: state.loginUrl });
  useAccessStore.getState().logout();
  if (state.signedIn) useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
  if (state.loginUrlAfterSignIn !== undefined) {
    useAccessStore.setState({ loginUrl: state.loginUrlAfterSignIn });
  }
  const expected = pick(useAccessStore.getState());
  await until(
    () =>
      JSON.stringify(pick(persisted("access-control"))) ===
      JSON.stringify(expected),
    "access config in the storage",
  );
  return expected;
}

beforeAll(async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  reloads = jest.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  // server config and built-in prompt lists
  global.fetch = jest.fn(async () => ({
    json: async () => ({ en: [], tw: [], cn: [] }),
  })) as unknown as typeof fetch;

  // the file picker: the "user" picks a file right after it opens; reading
  // the file and everything after it is the real code
  jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    const file = new File([pickedFile], "backup.json", {
      type: "application/json",
    });
    setTimeout(() => (this as any).onchange?.({ target: { files: [file] } }));
  });

  const { useAccessStore } = await import("../app/store/access");
  const { useChatStore } = await import("../app/store/chat");
  const { useAppConfig } = await import("../app/store/config");
  const { useMaskStore } = await import("../app/store/mask");
  const { usePromptStore } = await import("../app/store/prompt");
  const { useSyncStore } = await import("../app/store/sync");
  const { getLocalAppState } = await import("../app/utils/sync");
  stores = {
    useAccessStore,
    useChatStore,
    useAppConfig,
    useSyncStore,
    getLocalAppState,
  };
  // nothing is written to the storage before a store has read it
  await until(
    () =>
      [useAccessStore, useChatStore, useAppConfig, useMaskStore, usePromptStore]
        .map((store) => store.persist.hasHydrated())
        .every(Boolean),
    "stores read from the storage",
  );
  await useAccessStore.getState().whenConfigLoaded();
});

afterAll(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("import local data, signed in", () => {
  test("a backup that only changes the endpoint leaves the access config alone", async () => {
    const before = await setAccess({ loginUrl: LOGIN_URL, signedIn: true });
    const backup = backupWith({ openaiUrl: ELSEWHERE });

    await importFile(backup.text);
    await expectOtherDataImported(backup);

    expect(pick(stores.useAccessStore.getState())).toEqual(before);
    expect(pick(persisted("access-control"))).toEqual(before);
    expect(before.openaiUrl).toBe(API_ORIGIN);
    expect(before.openaiApiKey).toBe(TEST_KEY);
    expect(localStorage.getItem("access-control")).not.toContain(ELSEWHERE);
  });

  test("nor does a backup that changes the key, the login url and the rest", async () => {
    const before = await setAccess({ loginUrl: LOGIN_URL, signedIn: true });
    const backup = backupWith({
      openaiUrl: ELSEWHERE,
      openaiApiKey: FILE_KEY,
      useCustomConfig: false,
      loginUrl: `${ELSEWHERE}/chat-authorize`,
      loginAt: 0,
    });

    await importFile(backup.text);
    await expectOtherDataImported(backup);

    expect(pick(stores.useAccessStore.getState())).toEqual(before);
    expect(pick(persisted("access-control"))).toEqual(before);
    expect(localStorage.getItem("access-control")).not.toContain(ELSEWHERE);
    expect(localStorage.getItem("access-control")).not.toContain(FILE_KEY);
  });

  test("a key from a sign-in stays protected after sign-in is switched off", async () => {
    const before = await setAccess({
      loginUrl: LOGIN_URL,
      signedIn: true,
      loginUrlAfterSignIn: "",
    });
    const backup = backupWith({ openaiUrl: ELSEWHERE });

    await importFile(backup.text);
    await expectOtherDataImported(backup);

    expect(pick(persisted("access-control"))).toEqual(before);
    expect(before.openaiApiKey).toBe(TEST_KEY);
    expect(before.openaiUrl).toBe(API_ORIGIN);
  });
});

describe("import local data, sign-in configured but not signed in", () => {
  test("endpoint and key do not come from a file", async () => {
    const before = await setAccess({ loginUrl: LOGIN_URL, signedIn: false });
    const backup = backupWith({
      openaiUrl: ELSEWHERE,
      openaiApiKey: FILE_KEY,
      useCustomConfig: true,
    });

    await importFile(backup.text);
    await expectOtherDataImported(backup);

    expect(pick(persisted("access-control"))).toEqual(before);
    expect(before.openaiApiKey).toBe("");
  });
});

describe("import local data without sign-in", () => {
  test("works as before: the access config of the backup is merged in", async () => {
    await setAccess({ loginUrl: "", signedIn: false });
    const backup = backupWith({
      openaiUrl: ELSEWHERE,
      openaiApiKey: FILE_KEY,
      useCustomConfig: true,
    });

    await importFile(backup.text);
    await expectOtherDataImported(backup);

    const expected = {
      openaiApiKey: FILE_KEY,
      openaiUrl: ELSEWHERE,
      useCustomConfig: true,
      loginUrl: "",
      loginAt: 0,
    };
    expect(pick(stores.useAccessStore.getState())).toEqual(expected);
    expect(pick(persisted("access-control"))).toEqual(expected);
  });

  test("a file that is not a backup changes nothing", async () => {
    const before = await setAccess({ loginUrl: "", signedIn: false });
    pickedFile = "not json";
    await stores.useSyncStore.getState().import();
    expect(pick(stores.useAccessStore.getState())).toEqual(before);
  });
});

describe("cloud sync", () => {
  test("signed in: the synced state does not change the access config", async () => {
    const before = await setAccess({ loginUrl: LOGIN_URL, signedIn: true });
    const remote = backupWith({ openaiUrl: ELSEWHERE, openaiApiKey: FILE_KEY });

    const uploaded = await syncWith(remote.text);
    await expectOtherDataImported(remote);

    expect(pick(stores.useAccessStore.getState())).toEqual(before);
    expect(pick(persisted("access-control"))).toEqual(before);
    expect(uploaded).toHaveLength(1);
  });

  test("without sign-in it works as before", async () => {
    await setAccess({ loginUrl: "", signedIn: false });
    const remote = backupWith({ openaiUrl: ELSEWHERE, openaiApiKey: FILE_KEY });

    await syncWith(remote.text);
    await expectOtherDataImported(remote);

    expect(stores.useAccessStore.getState().openaiUrl).toBe(ELSEWHERE);
    expect(persisted("access-control").openaiUrl).toBe(ELSEWHERE);
    expect(persisted("access-control").openaiApiKey).toBe(FILE_KEY);
  });
});

// What leaves the browser the other way: the backup file "export" writes and
// the state cloud sync uploads. Both run the real store functions; only the
// click on the download link and the sync client are replaced.
describe("export and upload", () => {
  let downloads: string[];

  beforeEach(() => {
    downloads = [];
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        const href = this.getAttribute("href") ?? "";
        downloads.push(decodeURIComponent(href.slice(href.indexOf(",") + 1)));
      });
  });

  async function exported() {
    stores.useSyncStore.getState().export();
    await until(() => downloads.length === 1, "the backup file");
    return downloads[0];
  }

  /** the local state the way it is written out, for comparing the rest */
  const local = () => JSON.parse(JSON.stringify(stores.getLocalAppState()));

  test("signed in: the backup has no key and no record of the sign-in", async () => {
    await setAccess({ loginUrl: LOGIN_URL, signedIn: true });

    const text = await exported();
    const backup = JSON.parse(text);

    expect(text).not.toContain(TEST_KEY);
    for (const field of ["openaiApiKey", "loginAt", "loginOrigin"]) {
      expect(backup["access-control"]).not.toHaveProperty(field);
    }
    // everything else is in the file as it is in the browser
    const { openaiApiKey, loginAt, loginOrigin, ...restOfAccess } =
      local()["access-control"];
    expect(openaiApiKey).toBe(TEST_KEY);
    expect(backup).toEqual({ ...local(), "access-control": restOfAccess });
    expect(backup["chat-next-web-store"].sessions.length).toBeGreaterThan(0);
    // and the browser keeps its key
    expect(stores.useAccessStore.getState().openaiApiKey).toBe(TEST_KEY);
    expect(stores.useAccessStore.getState().loginAt).toBeGreaterThan(0);
  });

  test("a key from a sign-in stays out after sign-in is switched off", async () => {
    await setAccess({
      loginUrl: LOGIN_URL,
      signedIn: true,
      loginUrlAfterSignIn: "",
    });

    expect(await exported()).not.toContain(TEST_KEY);
  });

  test("without sign-in the backup is the whole state, as before", async () => {
    await setAccess({ loginUrl: "", signedIn: false });
    stores.useAccessStore.setState({ openaiApiKey: FILE_KEY });

    const text = await exported();

    expect(text).toBe(JSON.stringify(stores.getLocalAppState()));
    expect(JSON.parse(text)["access-control"].openaiApiKey).toBe(FILE_KEY);
  });

  test("signed in: what cloud sync uploads has no key either", async () => {
    await setAccess({ loginUrl: LOGIN_URL, signedIn: true });
    const remote = backupWith({});

    // a remote that holds a state, and one that is still empty
    const uploads = [...(await syncWith(remote.text)), ...(await syncWith(""))];

    expect(uploads).toHaveLength(2);
    for (const text of uploads) {
      expect(text).not.toContain(TEST_KEY);
      expect(JSON.parse(text)["access-control"]).not.toHaveProperty("loginAt");
      expect(JSON.parse(text)["chat-next-web-store"].sessions).toEqual(
        local()["chat-next-web-store"].sessions,
      );
    }
    expect(stores.useAccessStore.getState().openaiApiKey).toBe(TEST_KEY);
    expect(persisted("access-control").openaiApiKey).toBe(TEST_KEY);
  });

  test("without sign-in cloud sync uploads the whole state, as before", async () => {
    await setAccess({ loginUrl: "", signedIn: false });
    stores.useAccessStore.setState({ openaiApiKey: FILE_KEY });

    const [text] = await syncWith("");

    expect(text).toBe(JSON.stringify(stores.getLocalAppState()));
    expect(text).toContain(FILE_KEY);
  });
});
