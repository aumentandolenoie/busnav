package app.lineapilot.android;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Pure ordering logic for spoken guidance, identical to ios/Sources/VoiceCueQueue.swift.
 *
 * Close cues are no longer dropped or cut off: they wait and are read one after
 * the other, the stop or manoeuvre that comes first along the GPX first. A cue whose
 * target has already been passed, or that waited too long, is discarded instead of
 * being read late. A newer cue for the same stop/manoeuvre replaces the pending one.
 * The sentence is built only when it is read, with the metres still left at that moment.
 */
final class VoiceCueQueue {
    interface Maker { String make(Double left); }

    static final class Next {
        final String key, text;
        Next(String key, String text) { this.key = key; this.text = text; }
    }

    private static final class Cue {
        final String key; final Double target; final long sequence;
        long created; boolean behindSpeech; Maker make;
        Cue(String key, Double target, long created, long sequence, boolean behindSpeech, Maker make) {
            this.key = key; this.target = target; this.created = created; this.sequence = sequence;
            this.behindSpeech = behindSpeech; this.make = make;
        }
    }

    private static final Comparator<Cue> SPEAKS_FIRST = (a, b) -> {
        double at = a.target == null ? Double.NEGATIVE_INFINITY : a.target;
        double bt = b.target == null ? Double.NEGATIVE_INFINITY : b.target;
        if (at != bt) return at < bt ? -1 : 1;
        return Long.compare(a.sequence, b.sequence);
    };

    private final List<Cue> pending = new ArrayList<>();
    private long sequence;
    int maxPending = 4;
    long maxAgeMs = 25000;
    double passedTolerance = 5;
    long chainWindowMs = 2500;

    boolean isEmpty() { return pending.isEmpty(); }
    int size() { return pending.size(); }
    void clear() { pending.clear(); }

    /** Adds a cue or refreshes the pending one with the same key; false if it could not be kept. */
    boolean enqueue(String key, Double target, long now, boolean behindSpeech, Maker make) {
        for (Cue cue : pending) {
            if (cue.key.equals(key)) {
                cue.make = make; cue.created = now; cue.behindSpeech = cue.behindSpeech || behindSpeech;
                return true;
            }
        }
        Cue cue = new Cue(key, target, now, ++sequence, behindSpeech, make);
        pending.add(cue);
        pending.sort(SPEAKS_FIRST);
        while (pending.size() > maxPending) pending.remove(pending.size() - 1);
        return pending.contains(cue);
    }

    /** Drops passed or expired cues so they never take the place of a new one. */
    void discardStale(double along, boolean positionReliable, long now) {
        pending.removeIf(cue -> now - cue.created > maxAgeMs ||
                (positionReliable && cue.target != null && along > cue.target + passedTolerance));
    }

    /** Next cue still worth saying; cues tied to a position wait while GPS is unreliable. */
    Next next(double along, boolean positionReliable, long now, long lastSpeechEnd) {
        pending.removeIf(cue -> now - cue.created > maxAgeMs ||
                (positionReliable && cue.target != null && along > cue.target + passedTolerance));
        for (int i = 0; i < pending.size(); i++) {
            Cue cue = pending.get(i);
            if (cue.target != null && !positionReliable) continue;
            pending.remove(i--);
            String text = cue.make.make(cue.target == null ? null : cue.target - along);
            if (text == null || text.trim().isEmpty()) continue;
            text = text.trim();
            boolean chained = cue.behindSpeech && now - lastSpeechEnd < chainWindowMs;
            return new Next(cue.key, chained ? chained(text) : text);
        }
        return null;
    }

    /** "Svolta a destra." -> "Poi, svolta a destra." (acronyms such as "SS" keep their case). */
    static String chained(String text) {
        if (text.isEmpty()) return text;
        boolean lower = text.length() > 1 && Character.isLowerCase(text.charAt(1));
        String head = lower ? text.substring(0, 1).toLowerCase(java.util.Locale.ITALIAN) : text.substring(0, 1);
        return "Poi, " + head + text.substring(1);
    }
}
