# NutriSnap – PRD

## Original problem statement
> "crea un'app dove scattando foto, l'intelligenza artificiale riesce a riconoscere accuratamente le calorie, e le macro degli alimenti o dei cibi fotografati"

## Architecture
- **Backend**: FastAPI + MongoDB (motor). All routes prefixed `/api`.
- **AI**: Gemini 3 Flash Preview via `emergentintegrations` + Emergent Universal LLM Key.
- **Frontend**: React 19 + Tailwind + shadcn/ui + framer-motion + sonner.
- **Design**: Organic & Earthy dark theme, Outfit + Manrope fonts, glassmorphism, SVG progress rings.
- **Auth**: none – anonymous `device_id` (uuid) persisted in `localStorage`.
- **UI language**: Italiano.

## User personas
- Utente italiano che vuole tracciare l'alimentazione fotografando i pasti, senza registrazione, con obiettivo di dimagrire/mantenere/aumentare peso.

## Core requirements (static)
- Analisi foto → calorie + macro (proteine, carboidrati, grassi, fibre) accurate.
- Diario giornaliero dei pasti con progresso vs obiettivi.
- Profilo con età, sesso, altezza, peso attuale/obiettivo, attività.
- BMI calcolato e obiettivo calorico derivato dal peso obiettivo (Mifflin-St Jeor).

## Implemented (v1 – Feb 2026)
- Onboarding 3-step obbligatorio al primo avvio.
- `/api/analyze-food` (Gemini 3 Flash) restituisce JSON strutturato: dish_name, foods[], macro totali, note, confidence.
- `/api/profile` con calcolo Mifflin-St Jeor + fattore attività + aggiustamento obiettivo.
- `/api/meals` CRUD + `/api/daily-summary` con totali e goals.
- Pagine: **Diario** (progress ring calorie + 4 barre macro + storico pasti), **Fotocamera** (capture o upload, analisi, salvataggio), **Profilo** (BMI card + form ricalcolo).
- Bottom nav flottante glassmorphism.
- Tutti i test backend v1 (22/22) passati.

## Implemented (v2 – Feb 2026, Fitness Expansion)
### Meal Planning
- `POST /api/meal-plan/generate` – piani multi-giorno con 9 preset (bilanciato, iperproteico, ipocalorico, ipercalorico, keto, mediterraneo, vegetariano, vegano) o prompt custom, target kcal opzionale, allergie, 1–7 giorni.
- `POST/GET/DELETE /api/meal-plans` – salvataggio e gestione piani.
- Pagina **Piani** con tab "Nuovo/Salvati", generazione AI e visualizzazione pasti (colazione/pranzo/spuntino/cena) con ingredienti chip.

### Fitness Coaching
- `POST /api/coach/form-analysis` – analisi tecnica esercizio da 6 keyframe estratti client-side da video → score 0–100, verdict, strengths, corrections, risk_areas, cues.
- `POST /api/coach/program` – generazione programma periodizzato (obiettivo, livello, giorni/sett, attrezzatura, focus, plateau) con auto-detection plateau dai workout loggati.
- `POST /api/coach/recovery` – readiness score (algoritmo + AI advice) da sonno, DOMS, energia, stress, intensità ultimo workout.
- `POST/GET /api/workouts` – log allenamenti; plateau auto-detection UI se ≥3 log senza progresso su un esercizio.
- Pagina **Coach** con 4 sotto-sezioni: Tecnica, Programma, Recupero, Log.

### Robustezza
- `llm_json` con retry singolo su errori transienti Emergent LLM (5xx).
- Tutti i test backend v2 (10/10) passati.

## Implemented (v3 – Feb 2026, i18n + Ingredients-based planning)
- **EN/IT localization**: default English, IT available. First onboarding step is language selection. `X-Lang` axios header + `lang` field on all LLM endpoints so AI responds in the user's language.
- **Ingredients-based meal planning**: new preset `ingredients` with chip input (custom add + curated common list per language). AI builds meals around the provided ingredients.
- **Section-specific accent colors**: Nutrition (Diary+Snap) = coral `#E07A5F`, Planning = green `#81B29A`, Coach = steel blue `#6EA8C7`, Profile = warm sand `#D4A373`. Implemented via CSS var override (`--action-primary`) at page-wrapper level.
- Language toggle also available in Profile page.
- Backend v3 tests: 22/22 passing (12 new + 10 regression).

## Implemented (v4 – Feb 2026, Pantry AI + 8 languages + Workout diary)
- **8 languages** supported (EN default, ES, IT, FR, DE, SQ, EL, ZH) with flag grid selector both in onboarding (step 1) and in the Profile page.
- Backend `LANGUAGE_NAMES` + `normalize_lang()` + `RECOVERY_STATUS_LABELS` for all 8 languages. All LLM prompts instruct AI to respond in the target language name (non-IT branch reused for 7 languages).
- **Pantry AI**: `POST /api/pantry/extract` – photo of fridge/pantry → Gemini vision returns deduped list of edible ingredients (max 40, ≤50 chars each, in target language). New "Scan pantry" button inside the ingredient chip input on the Plans page.
- **Workout diary**: `GET /api/workouts` gained `log_date` filter; Diary page now shows a second section "Today's workouts" below meals with steel-blue accent (Coach section color) matching the Coach section identity.
- Frontend translations file covers all 8 languages with English fallback via `useLang().t()`.
- Backend v4 tests: 39/39 passing.

## Implemented (v5 – Feb 2026, Code-quality pass)
- **Python**: initialized possibly-undefined locals (`compute_bmi.cat`, `analyze_food.data`, `extract_pantry.data`) — eliminates linter warnings without behavioural change.
- **Backend**: `analyze_food` default `dish_name` fallback now language-aware ("Unknown dish" for non-IT / "Piatto non identificato" for IT) — no more IT leak into other languages when the LLM omits the field.
- **React hooks**: wrapped `loadProfile`/`load`/`loadSaved` in `useCallback` and added them to their `useEffect` deps — eliminates stale-closure risk.
- **Empty catches** now log errors (`console.error`) instead of silent failures.
- **Stable keys**: replaced all array-index keys with content-based composite keys (`${item.name}-${i}`, `day-${d.day}`, etc.) — preserves React state across list mutations.
- **localStorage**: added justification comments — only `device_id` (anonymous UUID) and `lang` (locale code) are stored, both non-sensitive; no auth data ever.
- **Rejected fix**: `is None` → `==` in tests — kept `is None`, which is the correct PEP 8 idiom (code review was mistaken).
- **Rejected fix**: complexity refactor of large components/routes — deferred, all functions still work correctly and tests validate them; noted as backlog.
- **Testing**: **49/49 backend tests passing** (regression pass, no functional changes).

## Prioritized backlog
### P1
- Salvataggio miniatura foto compressa nel diario (attualmente image_base64 non salvata per limiti storage).
- Grafico trend settimanale calorie + peso.
- Modifica manuale delle porzioni post-analisi (slider ×0.5 / ×1 / ×1.5).

### P2
- Ricerca cibi da database (senza foto).
- Notifiche promemoria pasti.
- Esportazione diario PDF / CSV.
- Multi-lingua (attualmente solo IT).

### P3
- Sincronizzazione multi-device tramite auth.
- Integrazione barcode packaged food.
