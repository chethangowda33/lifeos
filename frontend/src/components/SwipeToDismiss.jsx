import React from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

/* Wraps a card so it can be swiped left/right to dismiss (framer-motion drag).
   Also shows a small × button for non-touch users. Parent animates removal via AnimatePresence. */
export default function SwipeToDismiss({ onDismiss, children, className = "" }) {
  return (
    <motion.div
      layout
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 110 || Math.abs(info.velocity.x) > 500) onDismiss();
      }}
      exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.18 } }}
      whileDrag={{ cursor: "grabbing" }}
      className={`relative touch-pan-y ${className}`}
    >
      {children}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        aria-label="Dismiss recommendation"
        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground/70 hover:text-foreground hover:bg-muted transition opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
