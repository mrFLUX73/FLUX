# FLUX feature map

Keep this map short. Update a row only when its component, repository, RPC/table access, permissions or refresh contract changes.

| Feature | Component → repository | RPC / tables | Access and refresh | Important empty state |
|---|---|---|---|---|
| Auth | `PhonePasswordAuthGate` → `phonePasswordAuth` | Supabase Auth, `profiles`, `user_roles` | Password session persists in browser local storage; role read after verified user | Offline profile read uses verified Auth fallback, never guest data |
| Nutrition | `App` nutrition screens → nutrition repository | `products`, `meals`, `meal_items`, `nutrition_goals`, `nutrition_settings`; meal-item RPCs | User-owned RLS | A day without meals is valid |
| Workouts | `App` workout screens → workout state/repository | `exercises`, `workout_plans`, `workout_plan_exercises`, `workout_sessions`, `performed_sets` | User-owned RLS | No plan or sessions is valid |
| Trainer connection | `TrainerInviteUI` / `TrainerClientsScreen` → trainer repository | `trainer_profiles`, `trainer_client_links`; invite/request/respond/revoke RPCs | Links are RPC-only; one active trainer per client; Broadcast refreshes link changes | No trainer / no clients / pending are normal states |
| Trainer workspace | `TrainerClientWorkspace` → trainer repository | `get_trainer_client_overview`, `get_trainer_client_nutrition`, `get_trainer_client_workouts` | Active link required; trainer-only secure RPCs; refresh on opening/resync | Missing weight, meals, workouts or plan does not block workspace |
| Messenger | `MessengerDrawer` / trainer chat → trainer repository | `trainer_messages`, inbox/message/unread RPCs | Active link required; private Broadcast realtime plus resync | No messages starts an empty conversation |
| Trainer notes | `TrainerClientWorkspace` → trainer repository | `trainer_client_notes`; get/save/delete RPCs | Active link + trainer identity required | No notes is valid |
| QR invitation | `TrainerInviteUI` → invite helpers/repository | Trainer invite code and connection RPCs | Camera is requested only after user action | Manual invite-code entry remains the fallback |
