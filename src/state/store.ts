import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { CHORD_IDS } from '../music/chords';
import type { Attempt } from '../practice/session';
import { loadStats, recordAttempt, saveStats, clearStats, type StatsMap } from '../practice/stats';

export type View = 'browse' | 'practice' | 'progress';

interface AppState {
  view: View;
  /** Chords the player has chosen to work on. */
  selected: string[];
  /** The chord shown in the browser view. */
  focused: string;
  showNoteNames: boolean;
  /** Key chosen manually, or null to use the inferred one. */
  pinnedKeyId: string | null;
  /** Measured device round-trip in ms; 0 means uncalibrated. */
  calibrationOffsetMs: number;
  stats: StatsMap;

  setView: (view: View) => void;
  toggleSelected: (chordId: string) => void;
  setSelection: (chordIds: string[]) => void;
  focus: (chordId: string) => void;
  setShowNoteNames: (show: boolean) => void;
  pinKey: (keyId: string | null) => void;
  setCalibration: (ms: number) => void;
  recordAttempt: (attempt: Attempt) => void;
  resetStats: () => void;
}

const DEFAULT_SELECTION = ['C', 'F', 'G', 'Am'];

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: 'browse',
      selected: DEFAULT_SELECTION,
      focused: 'C',
      showNoteNames: false,
      pinnedKeyId: null,
      calibrationOffsetMs: 0,
      // Stats live in their own storage key so they survive changes to the
      // rest of the persisted shape.
      stats: loadStats(),

      setView: (view) => set({ view }),

      toggleSelected: (chordId) =>
        set((state) => ({
          selected: state.selected.includes(chordId)
            ? state.selected.filter((id) => id !== chordId)
            : [...state.selected, chordId].sort(
                (a, b) => CHORD_IDS.indexOf(a) - CHORD_IDS.indexOf(b),
              ),
        })),

      setSelection: (chordIds) => set({ selected: [...chordIds] }),
      focus: (chordId) => set({ focused: chordId }),
      setShowNoteNames: (showNoteNames) => set({ showNoteNames }),
      pinKey: (pinnedKeyId) => set({ pinnedKeyId }),
      setCalibration: (calibrationOffsetMs) => set({ calibrationOffsetMs }),

      recordAttempt: (attempt) =>
        set((state) => {
          const stats = recordAttempt(state.stats, attempt);
          saveStats(stats);
          return { stats };
        }),

      resetStats: () => {
        clearStats();
        set({ stats: {} });
      },
    }),
    {
      name: 'ukefriend.prefs.v1',
      storage: createJSONStorage(() => localStorage),
      // Stats have their own persistence; everything else is a preference.
      partialize: (state) => ({
        selected: state.selected,
        focused: state.focused,
        showNoteNames: state.showNoteNames,
        pinnedKeyId: state.pinnedKeyId,
        calibrationOffsetMs: state.calibrationOffsetMs,
      }),
    },
  ),
);
