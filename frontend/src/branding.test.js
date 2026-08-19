import fs from "fs";
import path from "path";

import { TRANSLATIONS } from "./i18n/translations";
import { GUEST_MIGRATION_KEYS } from "./lib/guestMigration";

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("Flaro visible branding and compatibility metadata", () => {
    test("browser metadata is Flaro and no user-loaded Emergent branding script remains", () => {
        const html = readProjectFile("public/index.html");

        expect(html).toContain("<title>Flaro</title>");
        expect(html).toContain('content="Track meals, workouts, profile goals and meal plans with Flaro."');
        expect(html).toContain('content="Flaro"');
        expect(html).toContain('href="%PUBLIC_URL%/manifest.json"');
        expect(html).not.toContain("Emergent | Fullstack App");
        expect(html).not.toContain("A product of emergent.sh");
        expect(html).not.toContain("emergent-main.js");
    });

    test("install metadata uses accurate text-only Flaro branding", () => {
        const manifest = JSON.parse(readProjectFile("public/manifest.json"));

        expect(manifest).toEqual(expect.objectContaining({
            name: "Flaro",
            short_name: "Flaro",
            description: "Track meals, workouts, profile goals and meal plans with Flaro.",
            theme_color: "#121A16",
            background_color: "#121A16",
        }));
        expect(manifest.icons).toBeUndefined();
    });

    test("the camera brand is Flaro in every supported language", () => {
        expect(Object.values(TRANSLATIONS).map((locale) => locale.camera.eyebrow))
            .toEqual(Object.keys(TRANSLATIONS).map(() => "Flaro AI"));
    });

    test("legacy storage identifiers remain unchanged for existing devices", () => {
        expect(GUEST_MIGRATION_KEYS).toEqual(expect.objectContaining({
            profile: "aura2_guest_profile",
            meals: "aura2_guest_meals",
            workouts: "aura2_guest_workouts",
            mealPlans: "aura2_guest_meal_plans",
            guestMode: "aura2_guest_mode",
            lastSummary: "aura2_last_summary",
            lastAddedMeal: "aura2_last_added_meal",
            deviceId: "nutrisnap_device_id",
        }));
        expect(readProjectFile("src/i18n/LangContext.jsx"))
            .toContain('const LANG_KEY = "nutrisnap_lang";');
    });
});
