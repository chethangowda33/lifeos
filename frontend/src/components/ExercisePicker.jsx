import React, { useEffect, useMemo, useState } from "react";
import api from "@/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Dumbbell, Cable, Cog, PersonStanding, Grip, CircleDot, Plus } from "lucide-react";
import { WORKOUT } from "@/constants/testIds";
import { MuscleThumb } from "@/components/MuscleHeatmap";

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

export default function ExercisePicker({ open, onClose, onPick }) {
  const [exercises, setExercises] = useState([]);
  const [search, setSearch] = useState("");
  const [equipment, setEquipment] = useState("all");
  const [muscle, setMuscle] = useState("all");
  const [meta, setMeta] = useState({ muscle_groups: [], equipment: [] });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", muscle_group: "", equipment: "", instructions: "" });
  const [saving, setSaving] = useState(false);
  const [recents, setRecents] = useState([]);

  const handlePick = (ex) => { pushRecent(ex); onPick(ex); };
  const showRecents = recents.length > 0 && !search && equipment === "all" && muscle === "all" && !creating;

  const saveCustom = async () => {
    if (!form.name.trim() || !form.muscle_group || !form.equipment) return;
    setSaving(true);
    try {
      const { data } = await api.post("/exercises", form);
      setCreating(false);
      setForm({ name: "", muscle_group: "", equipment: "", instructions: "" });
      handlePick(data);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    api.get("/exercises/meta").then(({ data }) => setMeta(data));
    setRecents(readRecents());
    setSearch("");
    setEquipment("all");
    setMuscle("all");
    setCreating(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const params = {};
    if (search) params.search = search;
    if (equipment !== "all") params.equipment = equipment;
    if (muscle !== "all") params.muscle_group = muscle;
    api.get("/exercises", { params }).then(({ data }) => setExercises(data));
  }, [open, search, equipment, muscle]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogTitle>Add Exercises</DialogTitle>
              <DialogDescription>Search, filter, and tap to add to your routine.</DialogDescription>
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
                {saving ? "Saving…" : "Save & add"}
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

        <div className="max-h-[55vh] overflow-y-auto -mx-2 px-2 space-y-1">
          {showRecents && (
            <>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground px-2 pt-1 pb-0.5">Recent</div>
              {recents.map((ex) => (
                <button
                  key={`recent-${ex.id}`}
                  onClick={() => handlePick(ex)}
                  className="w-full flex items-center gap-3 rounded-lg border border-transparent hover:border-maroon/40 hover:bg-muted/50 px-2 py-2 text-left transition"
                >
                  {ex.image_url ? (
                    <img src={ex.image_url} alt="" className="h-10 w-10 rounded object-cover bg-muted" onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center"><Dumbbell className="h-4 w-4 text-muted-foreground" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{ex.name}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">{ex.muscle_group} · {ex.equipment}</div>
                  </div>
                </button>
              ))}
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground px-2 pt-2 pb-0.5">All exercises</div>
            </>
          )}
          {exercises.map((ex) => (
            <button
              key={ex.id}
              data-testid={WORKOUT.pickerExerciseItem}
              onClick={() => handlePick(ex)}
              className="w-full flex items-center gap-3 rounded-lg border border-transparent hover:border-maroon/40 hover:bg-muted/50 px-2 py-2 text-left transition"
            >
              {ex.image_url ? (
                <img
                  src={ex.image_url}
                  alt=""
                  className="h-12 w-12 rounded object-cover bg-muted"
                  onError={(e) => { e.currentTarget.style.opacity = 0.3; }}
                />
              ) : (
                <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                  <Dumbbell className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{ex.name}</div>
                <div className="flex gap-1 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] capitalize">{ex.muscle_group}</Badge>
                  <Badge variant="outline" className="text-[10px] capitalize">{ex.equipment}</Badge>
                </div>
              </div>
            </button>
          ))}
          {exercises.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-12">No exercises found.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
