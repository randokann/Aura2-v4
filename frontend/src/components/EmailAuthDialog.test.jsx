import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { requestEmailMagicLink } from "../lib/emailAuth";
import { EmailAuthDialog } from "./EmailAuthDialog";

jest.mock("../lib/emailAuth", () => ({
    requestEmailMagicLink: jest.fn(),
    getEmailAuthErrorMessage: jest.fn(() => "safe error"),
}));

jest.mock("./ui/dialog", () => ({
    Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
    DialogDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
    DialogHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
    DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
}));

describe("EmailAuthDialog", () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        jest.clearAllMocks();
    });

    test("prevents duplicate sends and shows the check-email state", async () => {
        let finishRequest;
        requestEmailMagicLink.mockImplementation(() => new Promise((resolve) => {
            finishRequest = resolve;
        }));

        await act(async () => {
            root.render(<EmailAuthDialog open onOpenChange={() => {}} />);
        });

        const input = document.querySelector('[data-testid="email-auth-input"]');
        await act(async () => {
            const valueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            ).set;
            valueSetter.call(input, "user@example.com");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        const form = input.closest("form");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
        expect(requestEmailMagicLink).toHaveBeenCalledTimes(1);

        await act(async () => finishRequest("user@example.com"));
        expect(document.body.textContent).toContain("Check your email");
        expect(document.querySelector('[data-testid="email-auth-resend"]')).not.toBeNull();
    });
});
