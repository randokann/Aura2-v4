import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { useAuth } from "../auth/AuthProvider";
import { migrateGuestData } from "../lib/guestMigration";
import { GuestMigrationProvider, useGuestMigration } from "./GuestMigrationProvider";

jest.mock("../auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("../lib/guestMigration", () => ({ migrateGuestData: jest.fn() }));
jest.mock("../components/GuestImportModal", () => ({
    GuestImportModal: ({ mode, counts, onImport, onRetry, onContinue }) => (
        mode ? (
            <div data-testid="mock-import-modal" data-mode={mode}>
                <span>{counts.meals}/{counts.workouts}/{counts.mealPlans}</span>
                <button data-testid="mock-confirm" onClick={onImport}>Import</button>
                <button data-testid="mock-retry" onClick={onRetry}>Retry</button>
                <button data-testid="mock-continue" onClick={onContinue}>Continue</button>
            </div>
        ) : null
    ),
}));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "user@example.com" };
const SNAPSHOT = Object.freeze({ hasData: true, transformed: Object.freeze({ profile: {} }) });

function Observer() {
    const migration = useGuestMigration();
    return (
        <div
            data-testid="observer"
            data-status={migration.status}
            data-settled={String(migration.settled)}
            data-decision={String(migration.requiresDecision)}
            data-revision={String(migration.revision)}
            data-available={String(migration.hasImportableData)}
        >
            <button data-testid="recovery" onClick={migration.requestDeviceImport}>Recover</button>
        </div>
    );
}

describe("GuestMigrationProvider", () => {
    let container;
    let root;

    async function render() {
        await act(async () => {
            root.render(
                <GuestMigrationProvider>
                    <Observer />
                </GuestMigrationProvider>,
            );
        });
    }

    async function click(testId) {
        await act(async () => {
            document.querySelector(`[data-testid="${testId}"]`)
                .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
    }

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        useAuth.mockReturnValue({ user: USER, loading: false });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        jest.clearAllMocks();
    });

    test("automatically settles a new-account import before consumers continue", async () => {
        let resolveMigration;
        migrateGuestData.mockReturnValue(new Promise((resolve) => {
            resolveMigration = resolve;
        }));

        await render();
        expect(document.querySelector('[data-testid="observer"]').dataset.settled).toBe("false");
        expect(migrateGuestData).toHaveBeenCalledWith(expect.objectContaining({
            userId: USER.id,
            confirmExistingAccount: false,
            snapshot: null,
        }));

        await act(async () => {
            resolveMigration({
                status: "imported",
                response: { profile: { outcome: "imported" } },
                remaining: {
                    hasData: false,
                    profilePresent: false,
                    counts: { meals: 0, workouts: 0, mealPlans: 0 },
                },
            });
        });

        const observer = document.querySelector('[data-testid="observer"]');
        expect(observer.dataset.status).toBe("imported");
        expect(observer.dataset.settled).toBe("true");
        expect(observer.dataset.revision).toBe("1");
        expect(document.querySelector('[data-testid="mock-import-modal"]')).toBeNull();
    });

    test("confirmation modal imports the same snapshot with confirmation enabled", async () => {
        migrateGuestData
            .mockResolvedValueOnce({
                status: "confirmation_required",
                existing_profile: true,
                guest_meals: 2,
                guest_workouts: 1,
                guest_meal_plans: 3,
                snapshot: SNAPSHOT,
            })
            .mockResolvedValueOnce({
                status: "imported",
                response: { profile: { outcome: "skipped_existing" } },
                remaining: {
                    hasData: true,
                    profilePresent: true,
                    counts: { meals: 0, workouts: 0, mealPlans: 0 },
                },
            });

        await render();

        expect(document.querySelector('[data-testid="mock-import-modal"]').dataset.mode)
            .toBe("confirmation_required");
        expect(document.body.textContent).toContain("2/1/3");
        expect(document.querySelector('[data-testid="observer"]').dataset.decision).toBe("true");

        await click("mock-confirm");

        expect(migrateGuestData).toHaveBeenCalledTimes(2);
        expect(migrateGuestData.mock.calls[1][0]).toEqual(expect.objectContaining({
            userId: USER.id,
            confirmExistingAccount: true,
            snapshot: SNAPSHOT,
        }));
        expect(document.querySelector('[data-testid="mock-import-modal"]')).toBeNull();
        expect(document.querySelector('[data-testid="observer"]').dataset.available).toBe("false");
    });

    test("Not now preserves a recoverable authenticated state and the Profile entry point reuses the orchestrator", async () => {
        migrateGuestData.mockResolvedValue({
            status: "confirmation_required",
            existing_profile: true,
            guest_meals: 1,
            guest_workouts: 0,
            guest_meal_plans: 0,
            snapshot: SNAPSHOT,
        });

        await render();
        await click("mock-continue");

        let observer = document.querySelector('[data-testid="observer"]');
        expect(observer.dataset.status).toBe("deferred");
        expect(observer.dataset.settled).toBe("true");
        expect(observer.dataset.available).toBe("true");
        expect(document.querySelector('[data-testid="mock-import-modal"]')).toBeNull();

        await click("recovery");

        expect(migrateGuestData).toHaveBeenCalledTimes(2);
        expect(migrateGuestData.mock.calls[1][0]).toEqual(expect.objectContaining({
            userId: USER.id,
            confirmExistingAccount: false,
            snapshot: null,
        }));
    });

    test("failure requires a recoverable choice and Retry keeps the preserved snapshot", async () => {
        const error = Object.assign(new Error("offline"), {
            hasGuestData: true,
            snapshot: SNAPSHOT,
        });
        migrateGuestData
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce({ status: "no_data", remaining: { hasData: false } });

        await render();

        expect(document.querySelector('[data-testid="observer"]').dataset.settled).toBe("false");
        expect(document.querySelector('[data-testid="mock-import-modal"]').dataset.mode).toBe("failed");

        await click("mock-retry");

        expect(migrateGuestData.mock.calls[1][0]).toEqual(expect.objectContaining({
            snapshot: SNAPSHOT,
            confirmExistingAccount: false,
        }));
        expect(document.querySelector('[data-testid="observer"]').dataset.settled).toBe("true");
    });

    test("an authenticated browser with no guest data completes as a no-op", async () => {
        migrateGuestData.mockResolvedValue({ status: "no_data", remaining: { hasData: false } });

        await render();

        expect(migrateGuestData).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="observer"]').dataset.status).toBe("no_data");
        expect(document.querySelector('[data-testid="observer"]').dataset.settled).toBe("true");
    });
});
