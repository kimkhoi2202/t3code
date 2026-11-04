import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import { ProjectSettledThreadsDialog } from "./ProjectSettledThreadsDialog";

const entities = vi.hoisted(() => ({ threads: [] as ReadonlyArray<Thread> }));
vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useQuietThreadShells: () => entities.threads,
}));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("acme");
const project = {
  id: projectId,
  environmentId,
  title: "Acme",
  workspaceRoot: "/work/acme",
  repositoryIdentity: null,
  defaultModelSelection: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  scripts: [],
};
const group: SidebarProjectSnapshot = {
  ...project,
  projectKey: "local:acme",
  displayName: "Acme",
  groupedProjectCount: 1,
  environmentPresence: "local-only",
  allRemoteMembersAreDesktopLocal: false,
  allRemoteMembersAreWsl: false,
  memberProjects: [{ ...project, physicalProjectKey: "local:/work/acme", environmentLabel: null }],
  memberProjectRefs: [{ environmentId, projectId }],
  remoteEnvironmentLabels: [],
  pinned: false,
  archived: false,
};

function setup() {
  const thread = (id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) =>
    makeThreadFixture({ id: ThreadId.make(id), environmentId, projectId, title: id, ...overrides });
  entities.threads = [
    thread("older settled", { settledOverride: "settled", settledAt: "2026-03-02T00:00:00.000Z" }),
    thread("active"),
    thread("newer settled", { settledOverride: "settled", settledAt: "2026-03-04T00:00:00.000Z" }),
    thread("archived settled", {
      settledOverride: "settled",
      settledAt: "2026-03-05T00:00:00.000Z",
      archivedAt: "2026-03-06T00:00:00.000Z",
    }),
    thread("other project settled", {
      projectId: ProjectId.make("other"),
      settledOverride: "settled",
      settledAt: "2026-03-07T00:00:00.000Z",
    }),
  ];
}

it("lists only the project's settled threads, most recently settled first", async () => {
  setup();
  await using _screen = await render(
    <ProjectSettledThreadsDialog group={group} onClose={vi.fn()} onOpenThread={vi.fn()} />,
  );

  const dialog = page.getByRole("dialog", { name: "Settled threads" });
  await expect.element(dialog.getByText("· 2 threads")).toBeVisible();
  const titles = dialog
    .getByRole("listitem")
    .elements()
    .map((row) => row.querySelector("button span")?.textContent);
  expect(titles).toEqual(["newer settled", "older settled"]);
});
