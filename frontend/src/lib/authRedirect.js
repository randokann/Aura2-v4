const AUTH_ERROR_KEYS = ["error", "error_code", "error_description"];

function authErrorParams(locationObject) {
    if (!locationObject) return null;
    const search = new URLSearchParams(locationObject.search || "");
    const hash = new URLSearchParams((locationObject.hash || "").replace(/^#/, ""));
    return AUTH_ERROR_KEYS.some((key) => search.has(key) || hash.has(key))
        ? { search, hash }
        : null;
}

export function getAuthRedirectError(locationObject) {
    const location = locationObject
        ?? (typeof window === "undefined" ? null : window.location);
    const params = authErrorParams(location);
    if (!params) return null;

    const code = params.search.get("error_code") || params.hash.get("error_code") || "";
    const description = params.search.get("error_description")
        || params.hash.get("error_description")
        || "";
    const combined = `${code} ${description}`.toLowerCase();

    if (combined.includes("expired") || combined.includes("invalid") || combined.includes("otp")) {
        return "This sign-in link is invalid or has expired. Request a new link and try again.";
    }
    return "Email sign-in couldn't be completed. Please try again.";
}

export function clearAuthRedirectError(locationObject, historyObject) {
    const location = locationObject
        ?? (typeof window === "undefined" ? null : window.location);
    const history = historyObject
        ?? (typeof window === "undefined" ? null : window.history);
    const params = authErrorParams(location);
    if (!params || !history || !location) return false;

    AUTH_ERROR_KEYS.forEach((key) => params.search.delete(key));
    const search = params.search.toString();
    history.replaceState(
        {},
        typeof document === "undefined" ? "" : document.title,
        `${location.pathname || "/"}${search ? `?${search}` : ""}`,
    );
    return true;
}
