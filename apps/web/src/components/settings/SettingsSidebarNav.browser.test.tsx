import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
}));

import { SettingsSidebarNav } from "./SettingsSidebarNav";

it("mod+F goes to the settings search on a page without its own", async () => {
  await using screen = await render(
    <SidebarProvider>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
  );

  await userEvent.keyboard("{Control>}f{/Control}");
  await expect.element(screen.getByRole("combobox", { name: "Search settings" })).toHaveFocus();
});
