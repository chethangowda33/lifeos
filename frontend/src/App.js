import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Sparkles } from "lucide-react";

import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { Toaster } from "@/components/ui/toaster";

import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Workout from "@/pages/Workout";
import WorkoutSession from "@/pages/WorkoutSession";
import WorkoutSettings from "@/pages/WorkoutSettings";
import ExerciseDetail from "@/pages/ExerciseDetail";
import BodyMetrics from "@/pages/BodyMetrics";
import Progress from "@/pages/Progress";
import Reports from "@/pages/Reports";
import Coach from "@/pages/Coach";
import Admin from "@/pages/Admin";
import Habits from "@/pages/Habits";
import Sleep from "@/pages/Sleep";
import Connections from "@/pages/Connections";
import Intake from "@/features/intake/Intake";
import Placeholder from "@/pages/Placeholder";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/workout/settings" element={<WorkoutSettings />} />
              <Route path="/exercise/:exerciseId" element={<ExerciseDetail />} />
              <Route path="/workout/session/plan/:planId/:dayIndex" element={<WorkoutSession />} />
              <Route path="/workout/session/:routineId" element={<WorkoutSession />} />
              <Route path="/body-metrics" element={<BodyMetrics />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/intake" element={<Intake />} />
              {/* Old link; keep it working. */}
              <Route path="/nutrition" element={<Navigate to="/intake" replace />} />
              <Route path="/habits" element={<Habits />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/sleep" element={<Sleep />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/progress-old" element={<Placeholder title="Progress" description="Long-term trends across pillars." icon={Sparkles} />} />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
