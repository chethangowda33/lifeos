import React, { useEffect, useMemo, useState } from "react";
import api from "@/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Dumbbell, Cable, Cog, PersonStanding, Grip, CircleDot, Plus, Info, Check, Trash2 } from "lucide-react";
import { WORKOUT } from "@/constants/testIds";
import { MuscleThumb } from "@/components/MuscleHeatmap";
import ExerciseDetailDialog from "@/components/ExerciseDetailDialog";

const EQUIP_ICON = {
  barbell: Dumbbell, dumbbell: Dumbbell, machine: Cog, cable: Cable,
  bodyweight: PersonStanding, kettlebell: CircleDot, band: Grip,
};

const RECENTS_KEY = "lifeos:recent-exercises";
function readRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
}
function pushRecent(ex) {
  try {
    const list = readRecents().filter((e) => e.id !== ex.id);
    list.unshift({ id: ex.id, name: ex.name, image_url: ex.image_url, muscle_group: ex.muscle_group, equipment: ex.equipment });
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 6)));
  } catch { /* ignore quota */ }
}

/**
 * Exercise picker.
 *  - multiSelect (default): tick any number of exercises, then "Add" them all in
 *    one pass. onAdd(exercises[]) is called once.
 *  - single mode (multiSelect=false): tap a row to pick one — onPick(exercise).
 *    Used for "replace exercise" in a live session.
 *  - existingIds: ids already in the target routine/day — shown as "Added" and
 *    not selectable, so the same exercise can't be added twice.
 *  - resetSignal: filters (muscle / equipment) PERSIST across reopens for the
 *    whole routine-creation session; they only clear when this value changes
 *    (parent bumps it when a brand-new routine/plan build starts).
 */
export default function ExercisePicker({
  open, onClose, onAdd, onPick, existingIds = [], multiSelect = true, resetSignal,
}) {
  const [exercises, setExercises] = useState([]);
  const [search, setSearch] = useState("");
  const [equipment, setEquipment] = useState("all");
  const [muscle, setMuscle] = useState("all");
  const [meta, setMeta] = useState({ muscle_groups: [], equipment: [] });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", muscle_group: "", equipment: "", instructions: "" });
  const [saving, setSaving] = useState(false);
  const [recents, setRecents] = useState([]);
  const [selected, setSelected] = useState({}); // id -> exercise object
  const [detailEx, setDetailEx] = useState(null); // exercise to show full detail for
  const [loading, setLoading] = useState(false); // fetching the library (cold backend can be slow)
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0); // manual retry

  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const selectedList = useMemo(() => Object.values(selected), [selected]);
  const showRecents = recents.length > 0 && !search && equipment === "all" && muscle === "all" && !creating;

  const commit = (list) => {
    if (!list.length) return;
    list.forEach(pushRecent);
    onAdd?.(list);
    onClose();
  };

  // Remove one of your own custom exercises (library ones aren't deletable).
  const deleteCustom = async (ex) => {
    if (!window.confirm(`Delete custom exercise "${ex.name}"?`)) return;
    try {
      await api.delete(`/exercises/${ex.id}`);
      setExercises((arr) => arr.filter((x) => x.id !== ex.id));
      setSelected((prev) => {
        const next = { ...prev };
        delete next[ex.id];
        return next;
      });
      setRecents((r) => r.filter((x) => x.id !== ex.id));
    } catch { /* leave the row in place if it fails */ }
  };

  const toggle = (ex) => {
    if (existing.has(ex.id)) return;
    if (!multiSelect) { pushRecent(ex); onPick?.(ex); return; }
    setSelected((prev) => {
      const next = { ...prev };
      if (next[ex.id]) delete next[ex.id]; else next[ex.id] = ex;
      return next;
    });
  };

  const saveCustom = async () => {
    if (!form.name.trim() || !form.muscle_group || !form.equipment) return;
    setSaving(true);
    try {
      const { data } = await api.post("/exercises", form);
      setCreating(false);
      setForm({ name: "", muscle_group: "", equipment: "", instructions: "" });
      if (!multiSelect) { pushRecent(data); onPick?.(data); return; }
      setSelected((prev) => ({ ...prev, [data.id]: data })); // stage it; user presses Add
    } finally {
      setSaving(false);
    }
  };

  // On open: refresh library meta + recents, and clear transient state (search,
  // create form, selection). Filters are intentionally NOT reset here so they
  // survive closing/reopening the picker within one routine-creation session.
  useEffect(() => {
    if (!open) return;
    api.get("/exercises/meta").then(({ data }) => setMeta(data));
    setRecents(readRecents());
    setSearch("");
    setCreating(false);
    setSelected({});
  }, [open]);

  // New routine/plan build started → clear the persisted filters.
  useEffect(() => {
    setEquipment("all");
    setMuscle("all");
  }, [resetSignal]);

  useEffect(() => {
    if (!open) return;
    const params = {};
    if (search) params.search = search;
    if (equipment !== "all") params.equipment = equipment;
    if (muscle !== "all") params.muscle_group = muscle;
    let alive = true;
    setLoading(true);
    setLoadError(false);
    api.get("/exercises", { params })
      .then(({ data }) => { if (alive) setExercises(data); })
      .catch(() => { if (alive) { setLoadError(true); setExercises([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, search, equipment, muscle, reloadTick]);

  const Row = ({ ex, size = 12 }) => {
    const added = existing.has(ex.id);
    const checked = !!selected[ex.id];
    const Icon = EQUIP_ICON[ex.equipment] || Grip;
    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={WORKOUT.pickerExerciseItem}
        onClick={() => toggle(ex)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(ex); } }}
        aria-disabled={added}
        className={`w-full flex items-center gap-3 rounded-lg border px-2 py-2 text-left transition ${
          added
            ? "border-transparent opacity-55 cursor-default"
            : checked
              ? "border-maroon/60 bg-maroon/10 cursor-pointer"
              : "border-transparent hover:border-maroon/40 hover:bg-muted/50 cursor-pointer"
        }`}
      >
        {multiSelect && (
          added
            ? <span className="h-5 w-5 shrink-0 rounded-[4px] bg-maroon/70 text-white flex items-center justify-center"><Check className="h-3.5 w-3.5" /></span>
            : <Checkbox checked={checked} className="shrink-0 pointer-events-none" tabIndex={-1} />
        )}
        {ex.image_url ? (
          <img
            src={ex.image_url}
            alt=""
            className="rounded object-cover bg-muted"
            style={{ height: size * 4, width: size * 4 }}
            onError={(e) => { e.currentTarget.style.opacity = 0.3; }}
          />
        ) : (
          <div className="rounded bg-muted flex items-center justify-center" style={{ height: size * 4, width: size * 4 }}>
            <Dumbbell className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {ex.name}
            {added && <span className="text-[10px] uppercase tracking-wide text-maroon">Added</span>}
          </div>
          <div className="flex gap-1 mt-0.5">
            <Badge variant="secondary" className="text-[10px] capitalize">{ex.muscle_group}</Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              <Icon className="h-3 w-3 mr-1 inline" />{ex.equipment}
            </Badge>
          </div>
        </div>
        {ex.custom && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); deleteCustom(ex); }}
            className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition"
            aria-label={`Delete ${ex.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetailEx(ex); }}
          className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-maroon hover:bg-muted transition"
          aria-label={`Details for ${ex.name}`}
        >
          <Info className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[88vh]">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogTitle>Add Exercises</DialogTitle>
              <DialogDescription>
                {multiSelect ? "Search, filter, tick exercises, then add them all." : "Search, filter, and tap to pick."}
              </DialogDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create
            </Button>
          </div>
        </DialogHeader>

        {creating && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="text-sm font-medium">New custom exercise</div>
            <Input
              placeholder="Exercise name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={form.muscle_group} onValueChange={(v) => setForm((f) => ({ ...f, muscle_group: v }))}>
                <SelectTrigger className="capitalize"><SelectValue placeholder="Muscle group" /></SelectTrigger>
                <SelectContent>
                  {meta.muscle_groups.map((m) => (
                    <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.equipment} onValueChange={(v) => setForm((f) => ({ ...f, equipment: v }))}>
                <SelectTrigger className="capitalize"><SelectValue placeholder="Equipment" /></SelectTrigger>
                <SelectContent>
                  {meta.equipment.map((e) => (
                    <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Instructions (optional)"
              rows={2}
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={saving || !form.name.trim() || !form.muscle_group || !form.equipment}
                onClick={saveCustom}
                className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
              >
                {saving ? "Saving…" : multiSelect ? "Save & tick" : "Save & add"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid={WORKOUT.pickerSearch}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exercises…"
              className="pl-9"
            />
          </div>
          <Select value={equipment} onValueChange={setEquipment}>
            <SelectTrigger data-testid={WORKOUT.pickerFilterEquipment} className="w-full sm:w-40 capitalize">
              <SelectValue placeholder="All Equipment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Equipment</SelectItem>
              {meta.equipment.map((e) => {
                const Icon = EQUIP_ICON[e] || Grip;
                return (
                  <SelectItem key={e} value={e} className="capitalize">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" /> {e}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={muscle} onValueChange={setMuscle}>
            <SelectTrigger data-testid={WORKOUT.pickerFilterMuscle} className="w-full sm:w-40 capitalize">
              <SelectValue placeholder="All Muscles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Muscles</SelectItem>
              {meta.muscle_groups.map((m) => (
                <SelectItem key={m} value={m} className="capitalize">
                  <span className="flex items-center gap-2">
                    <span className="h-8 w-8 shrink-0 rounded-full bg-white flex items-center justify-center overflow-hidden">
                      <MuscleThumb group={m} size={30} />
                    </span>
                    {m}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-1">
          {showRecents && (
            <>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground px-2 pt-1 pb-0.5">Recent</div>
              {recents.map((ex) => <Row key={`recent-${ex.id}`} ex={ex} size={10} />)}
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-0.5">All exercises</div>
            </>
          )}
          {!loadError && exercises.map((ex) => <Row key={ex.id} ex={ex} />)}
          {loading && exercises.length === 0 && (
            <div className="space-y-1 pt-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <div className="h-11 w-11 rounded bg-muted animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-1/3 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {loadError && (
            <div className="text-center text-sm py-12">
              <p className="text-muted-foreground">Couldn&apos;t load exercises. The server may be waking up — give it a moment.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setReloadTick((n) => n + 1)}>
                Retry
              </Button>
            </div>
          )}
          {!loading && !loadError && exercises.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-12">No exercises found.</div>
          )}
        </div>

        {multiSelect && (
          <DialogFooter className="sm:justify-between items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedList.length ? `${selectedList.length} selected` : "Tick exercises to add"}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                disabled={!selectedList.length}
                onClick={() => commit(selectedList)}
                className="bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
              >
                {selectedList.length ? `Add ${selectedList.length}` : "Add"}
              </Button>
            </div>
          </DialogFooter>
        )}

        <ExerciseDetailDialog
          open={!!detailEx}
          exercise={detailEx}
          exerciseId={detailEx?.id}
          onClose={() => setDetailEx(null)}
        />
      </DialogContent>
    </Dialog>
  );
}
