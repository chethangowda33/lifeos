import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import ExerciseDetailContent from "@/components/ExerciseDetailContent";

export default function ExerciseDetail() {
  const { exerciseId } = useParams();
  const navigate = useNavigate();
  const [exercise, setExercise] = useState(null);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {exercise && (
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight truncate">{exercise.name}</h1>
            <div className="flex gap-1.5 mt-0.5">
              <Badge variant="secondary" className="text-[10px] capitalize">{exercise.muscle_group}</Badge>
              <Badge variant="outline" className="text-[10px] capitalize">{exercise.equipment}</Badge>
            </div>
          </div>
        )}
      </div>

      <ExerciseDetailContent exerciseId={exerciseId} onLoaded={setExercise} />
    </div>
  );
}
