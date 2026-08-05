// frontend/src/lib/guestStorage.js
// Helper library for storing guest-mode data in localStorage.

const KEY_PROFILE = "aura2_guest_profile";
const KEY_MEALS = "aura2_guest_meals";
const KEY_MEAL_PLANS = "aura2_guest_meal_plans";
const KEY_WORKOUTS = "aura2_guest_workouts";
const KEY_GUEST_MODE = "aura2_guest_mode"; // used elsewhere in the app; we honour it here

// Safe localStorage helpers
function safeGetItem(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function safeRemoveItem(key) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

function parseJSON(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function stringifySafe(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return null;
  }
}

function generateId() {
  // Simple local unique id — not cryptographically strong but sufficient for guest data
  return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// Public API
export function isGuestMode() {
  try {
    const gm = safeGetItem(KEY_GUEST_MODE);
    if (gm === "true") return true;
    // fallback: if a profile exists, consider guest mode active
    const raw = safeGetItem(KEY_PROFILE);
    if (raw) return true;
    return false;
  } catch (e) {
    return false;
  }
}

export function clearGuestData() {
  // Remove guest profile, meals, plans, workouts and guest_mode flag if present
  safeRemoveItem(KEY_PROFILE);
  safeRemoveItem(KEY_MEALS);
  safeRemoveItem(KEY_MEAL_PLANS);
  safeRemoveItem(KEY_WORKOUTS);
  safeRemoveItem(KEY_GUEST_MODE);
}

// Profile
export function getGuestProfile() {
  const raw = safeGetItem(KEY_PROFILE);
  return parseJSON(raw, null);
}

export function saveGuestProfile(profile) {
  const raw = stringifySafe(profile);
  if (raw === null) return false;
  return safeSetItem(KEY_PROFILE, raw);
}

// Meals
export function getGuestMeals() {
  const raw = safeGetItem(KEY_MEALS);
  return parseJSON(raw, []);
}

export function saveGuestMeals(meals) {
  const raw = stringifySafe(Array.isArray(meals) ? meals : []);
  if (raw === null) return false;
  return safeSetItem(KEY_MEALS, raw);
}

export function addGuestMeal(meal) {
  try {
    const meals = getGuestMeals();
    const item = { ...meal };
    if (item.id == null) item.id = generateId();
    meals.push(item);
    saveGuestMeals(meals);
    return item;
  } catch (e) {
    return null;
  }
}

export function deleteGuestMeal(id) {
  try {
    if (id == null) return false;
    const meals = getGuestMeals();
    const filtered = meals.filter((m) => m && m.id !== id);
    saveGuestMeals(filtered);
    return true;
  } catch (e) {
    return false;
  }
}

// Meal plans
export function getGuestMealPlans() {
  const raw = safeGetItem(KEY_MEAL_PLANS);
  return parseJSON(raw, []);
}

export function saveGuestMealPlans(plans) {
  const raw = stringifySafe(Array.isArray(plans) ? plans : []);
  if (raw === null) return false;
  return safeSetItem(KEY_MEAL_PLANS, raw);
}

export function addGuestMealPlan(plan) {
  try {
    const plans = getGuestMealPlans();
    const item = { ...plan };
    if (item.id == null) item.id = generateId();
    plans.push(item);
    saveGuestMealPlans(plans);
    return item;
  } catch (e) {
    return null;
  }
}

export function deleteGuestMealPlan(id) {
  try {
    if (id == null) return false;
    const plans = getGuestMealPlans();
    const filtered = plans.filter((p) => p && p.id !== id);
    saveGuestMealPlans(filtered);
    return true;
  } catch (e) {
    return false;
  }
}

// Workouts
export function getGuestWorkouts() {
  const raw = safeGetItem(KEY_WORKOUTS);
  return parseJSON(raw, []);
}

export function saveGuestWorkouts(workouts) {
  const raw = stringifySafe(Array.isArray(workouts) ? workouts : []);
  if (raw === null) return false;
  return safeSetItem(KEY_WORKOUTS, raw);
}

export function addGuestWorkout(workout) {
  try {
    const workouts = getGuestWorkouts();
    const item = { ...workout };
    if (item.id == null) item.id = generateId();
    workouts.push(item);
    saveGuestWorkouts(workouts);
    return item;
  } catch (e) {
    return null;
  }
}

export function deleteGuestWorkout(id) {
  try {
    if (id == null) return false;
    const workouts = getGuestWorkouts();
    const filtered = workouts.filter((w) => w && w.id !== id);
    saveGuestWorkouts(filtered);
    return true;
  } catch (e) {
    return false;
  }
}
