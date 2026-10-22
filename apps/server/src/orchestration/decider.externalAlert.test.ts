// External alerts now dispatch through orchestration v2. Keep this entry point because the
// frozen fork-release gate invokes it directly.
import "../orchestration-v2/decider.externalAlert.test.ts";

import "../orchestration-v2/MaintenanceDispatch.test.ts";
