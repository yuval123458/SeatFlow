package com.seatflow.solver;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Seat assignment solver.
 *
 * <p>{@link #solve} runs the greedy heuristic N times on a fixed thread pool, each run with its own
 * random seed so the noise differs, scores every resulting plan with {@link #score}, and returns the
 * plan with the lowest penalty.
 */
public final class Solver {

    // ------------------------------------------------------------------ data

    /** {@code seatNumber} may be null when the venue's numbering is not numeric. */
    public record Seat(long id, String zone, String rowLabel, Integer seatNumber, double x, double y,
                       boolean aisle, boolean accessible, boolean blocked) {}

    public record Person(long id, String groupCode, String preferredZone, boolean wantsAisle,
                         boolean needsAccessible, Long previousSeatId) {
        boolean hasZone() { return preferredZone != null && !preferredZone.isBlank(); }
        boolean hasGroup() { return groupCode != null && !groupCode.isBlank(); }
    }

    /** Weights are 0..100 like the UI sliders. {@code runs} defaults to 100, {@code seed} to random. */
    public record Request(List<Seat> seats, List<Person> people, int preferenceWeight, int stabilityWeight,
                          Boolean groupAdjacency, Integer runs, Long seed) {
        boolean adjacency() { return groupAdjacency == null || groupAdjacency; }
    }

    /** Penalty a plan pays, split by cause. Lower is better; zero is perfect. */
    public record Breakdown(double unseated, double groupSplit, double groupDistance, double zoneMiss,
                            double aisleMiss, double moved, double front) {
        public double total() {
            return unseated + groupSplit + groupDistance + zoneMiss + aisleMiss + moved + front;
        }
    }

    /** People missing from {@code assignments} are listed in {@code unseatedPersonIds}. */
    public record Result(Map<Long, Long> assignments, double score, Breakdown breakdown,
                         List<Long> unseatedPersonIds, int runs, long seed, int bestRunIndex, long elapsedMs) {}

    // ------------------------------------------------------------ constants

    static final double UNSEATED_PENALTY = 1000.0;
    static final double EXTRA_BLOCK_PENALTY = 100.0;
    static final double DISTANCE_PENALTY_PER_UNIT = 10.0;
    static final int MAX_RUNS = 500;
    static final double STRICT_THRESHOLD = 0.90;
    static final double PICK_JITTER = 0.01;
    /** Per person, per row away from the stage. Small: breaks ties toward the front, never beats a preference. */
    static final double FRONT_PENALTY_PER_ROW = 0.5;

    /**
     * Distance from the stage in rows. The seat map convention is that the stage is at the top, so the
     * smallest y is the front row. A "row" is the smallest gap between distinct y values in the venue,
     * which makes the term independent of the coordinate scale.
     */
    record Geometry(double minY, double pitch) {
        double rowsFromFront(Seat s) { return (s.y() - minY) / pitch; }

        static Geometry of(Request req) {
            java.util.TreeSet<Double> ys = new java.util.TreeSet<>();
            for (Seat s : req.seats()) ys.add(s.y());
            double minY = ys.isEmpty() ? 0.0 : ys.first();
            double pitch = Double.MAX_VALUE, prev = Double.NaN;
            for (double y : ys) {
                if (!Double.isNaN(prev) && y - prev > 1e-9) pitch = Math.min(pitch, y - prev);
                prev = y;
            }
            return new Geometry(minY, pitch == Double.MAX_VALUE ? 1.0 : pitch);
        }
    }

    private static final ExecutorService POOL =
            Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());

    private Solver() {}

    // ------------------------------------------------------- parallel driver

    private record Candidate(int index, Map<Long, Long> plan, Breakdown breakdown) {}

    public static Result solve(Request req) {
        long start = System.nanoTime();
        int runs = req.runs() == null ? 100 : Math.max(1, Math.min(MAX_RUNS, req.runs()));
        long seed = req.seed() != null ? req.seed() : ThreadLocalRandom.current().nextLong();

        List<Future<Candidate>> futures = new ArrayList<>(runs);
        for (int i = 0; i < runs; i++) {
            final int index = i;
            futures.add(POOL.submit(() -> {
                Map<Long, Long> plan = new Run(req, new Random(seed + index)).solve();
                Breakdown b = isValid(req, plan) ? score(req, plan) : null;
                return new Candidate(index, plan, b);
            }));
        }

        Candidate best = null;
        try {
            for (Future<Candidate> f : futures) {
                Candidate c = f.get();
                if (c.breakdown() == null) continue;
                if (best == null || c.breakdown().total() < best.breakdown().total()) best = c;
            }
        } catch (Exception e) {
            throw new IllegalStateException("solver run failed", e);
        }
        if (best == null) throw new IllegalStateException("no valid plan produced");

        List<Long> unseated = new ArrayList<>();
        for (Person p : req.people()) if (!best.plan().containsKey(p.id())) unseated.add(p.id());

        return new Result(best.plan(), best.breakdown().total(), best.breakdown(), unseated, runs, seed,
                best.index(), (System.nanoTime() - start) / 1_000_000);
    }

    // --------------------------------------------------------------- scoring

    /** Hard rules: no blocked seats, accessible-needers only on accessible seats, one person per seat. */
    static boolean isValid(Request req, Map<Long, Long> plan) {
        Map<Long, Seat> seatById = seatIndex(req);
        Set<Long> taken = new HashSet<>();
        for (Person p : req.people()) {
            Long sid = plan.get(p.id());
            if (sid == null) continue;
            Seat s = seatById.get(sid);
            if (s == null || s.blocked()) return false;
            if (p.needsAccessible() && !s.accessible()) return false;
            if (!taken.add(sid)) return false;
        }
        return true;
    }

    static Breakdown score(Request req, Map<Long, Long> plan) {
        Map<Long, Seat> seatById = seatIndex(req);
        Geometry geo = Geometry.of(req);
        double unseated = 0, zoneMiss = 0, aisleMiss = 0, moved = 0, front = 0;
        Map<String, List<Seat>> seatsByGroup = new LinkedHashMap<>();

        for (Person p : req.people()) {
            Seat s = plan.containsKey(p.id()) ? seatById.get(plan.get(p.id())) : null;
            if (s == null) { unseated += UNSEATED_PENALTY; continue; }
            if (p.hasZone() && !p.preferredZone().equals(s.zone())) zoneMiss += req.preferenceWeight();
            if (p.wantsAisle() && !s.aisle()) aisleMiss += req.preferenceWeight();
            if (p.previousSeatId() != null && !p.previousSeatId().equals(s.id())) moved += req.stabilityWeight();
            front += FRONT_PENALTY_PER_ROW * geo.rowsFromFront(s);
            if (p.hasGroup()) seatsByGroup.computeIfAbsent(p.groupCode(), k -> new ArrayList<>()).add(s);
        }

        double groupSplit = 0, groupDistance = 0;
        if (req.adjacency()) {
            for (List<Seat> seats : seatsByGroup.values()) {
                if (seats.size() < 2) continue;
                List<List<Seat>> blocks = contiguousBlocks(seats);
                groupSplit += EXTRA_BLOCK_PENALTY * (blocks.size() - 1);
                groupDistance += DISTANCE_PENALTY_PER_UNIT * spread(blocks);
            }
        }
        return new Breakdown(unseated, groupSplit, groupDistance, zoneMiss, aisleMiss, moved, front);
    }

    /** Maximal runs of consecutive seat numbers within one zone and row. Unnumbered seats stand alone. */
    static List<List<Seat>> contiguousBlocks(List<Seat> seats) {
        Map<String, List<Seat>> byRow = new LinkedHashMap<>();
        for (Seat s : seats) byRow.computeIfAbsent(rowKey(s), k -> new ArrayList<>()).add(s);

        List<List<Seat>> blocks = new ArrayList<>();
        for (List<Seat> row : byRow.values()) {
            row.sort(Comparator.comparingInt(s -> s.seatNumber() == null ? Integer.MAX_VALUE : s.seatNumber()));
            List<Seat> current = new ArrayList<>();
            Integer last = null;
            for (Seat s : row) {
                boolean continues = s.seatNumber() != null && last != null && s.seatNumber() == last + 1;
                if (!continues && !current.isEmpty()) { blocks.add(current); current = new ArrayList<>(); }
                current.add(s);
                last = s.seatNumber();
            }
            if (!current.isEmpty()) blocks.add(current);
        }
        return blocks;
    }

    /** Sum of distances from each block's centroid to the largest block's centroid. */
    private static double spread(List<List<Seat>> blocks) {
        List<Seat> largest = blocks.get(0);
        for (List<Seat> b : blocks) if (b.size() > largest.size()) largest = b;
        double[] anchor = centroid(largest);
        double sum = 0;
        for (List<Seat> b : blocks) {
            if (b == largest) continue;
            double[] c = centroid(b);
            sum += Math.hypot(c[0] - anchor[0], c[1] - anchor[1]);
        }
        return sum;
    }

    private static double[] centroid(List<Seat> seats) {
        double sx = 0, sy = 0;
        for (Seat s : seats) { sx += s.x(); sy += s.y(); }
        return new double[] {sx / seats.size(), sy / seats.size()};
    }

    private static String rowKey(Seat s) {
        return (s.zone() == null ? "" : s.zone()) + " " + (s.rowLabel() == null ? "" : s.rowLabel());
    }

    private static Map<Long, Seat> seatIndex(Request req) {
        Map<Long, Seat> m = new HashMap<>();
        for (Seat s : req.seats()) m.put(s.id(), s);
        return m;
    }

    // ----------------------------------------------------- one greedy run

    /**
     * One randomized greedy pass. A port of the Python heuristic in
     * {@code server/app/services/events_service.py} with noise in four places: group order,
     * window choice, individual order, and the per-seat score.
     */
    private static final class Run {
        private final Request req;
        private final Random rnd;
        private final Map<Long, Seat> seatById = new HashMap<>();
        private final Set<Long> accessibleIds = new HashSet<>();
        private final Map<Long, Long> prevSeat = new HashMap<>();
        private final Set<Long> free = new LinkedHashSet<>();
        private final Set<Long> used = new LinkedHashSet<>();
        private final Map<Long, Long> planned = new LinkedHashMap<>();
        private final Geometry geo;
        private final double wPref;
        private double wStab;
        private final boolean strictMember;
        private boolean strictStab;
        private int accDemandRemaining;

        Run(Request req, Random rnd) {
            this.req = req;
            this.rnd = rnd;
            this.geo = Geometry.of(req);
            for (Seat s : req.seats()) {
                if (s.blocked()) continue;
                seatById.put(s.id(), s);
                if (s.accessible()) accessibleIds.add(s.id());
            }
            for (Person p : req.people()) {
                if (p.previousSeatId() != null && seatById.containsKey(p.previousSeatId())) {
                    prevSeat.put(p.id(), p.previousSeatId());
                }
                if (p.needsAccessible()) accDemandRemaining++;
            }
            wPref = req.preferenceWeight() / 100.0;
            wStab = prevSeat.isEmpty() ? 0.0 : req.stabilityWeight() / 100.0;
            strictMember = wPref >= STRICT_THRESHOLD;
            strictStab = wStab >= STRICT_THRESHOLD;
            free.addAll(seatById.keySet());
        }

        Map<Long, Long> solve() {
            if (strictStab) repinPreviousSeats();
            if (req.adjacency()) placeGroups();
            placeIndividuals();
            return planned;
        }

        // -- basic rules

        private boolean hardOk(Person p, Seat s) {
            return !s.blocked() && (!p.needsAccessible() || s.accessible());
        }

        private boolean matchesPref(Person p, Seat s) {
            boolean zoneOk = !p.hasZone() || p.preferredZone().equals(s.zone());
            boolean aisleOk = !p.wantsAisle() || s.aisle();
            return zoneOk && aisleOk;
        }

        private boolean memberStrict(Person p) {
            return strictMember || p.hasZone();
        }

        private boolean isPlanned(Person p) {
            return planned.containsKey(p.id());
        }

        private void claim(Person p, long sid) {
            planned.put(p.id(), sid);
            used.add(sid);
            free.remove(sid);
            if (p.needsAccessible()) accDemandRemaining--;
        }

        // -- step 1: strict stability

        private void repinPreviousSeats() {
            for (Person p : req.people()) {
                Long sid = prevSeat.get(p.id());
                if (sid == null || used.contains(sid)) continue;
                if (hardOk(p, seatById.get(sid))) claim(p, sid);
            }
        }

        // -- step 2: groups

        private void placeGroups() {
            Map<String, List<Person>> groups = new LinkedHashMap<>();
            for (Person p : req.people()) {
                if (p.hasGroup() && !isPlanned(p)) groups.computeIfAbsent(p.groupCode(), k -> new ArrayList<>()).add(p);
            }
            // Groups with an accessible-seat user can only sit where those seats are, so they go first.
            Map<String, List<Person>> constrained = new LinkedHashMap<>(), others = new LinkedHashMap<>();
            for (Map.Entry<String, List<Person>> e : groups.entrySet()) {
                boolean hasNeeder = e.getValue().stream().anyMatch(Person::needsAccessible);
                (hasNeeder ? constrained : others).put(e.getKey(), e.getValue());
            }
            List<String> order = new ArrayList<>(weightedOrder(constrained));
            order.addAll(weightedOrder(others));
            for (String code : order) {
                List<Person> members = new ArrayList<>(groups.get(code));
                members.removeIf(this::isPlanned);
                if (members.size() < 2) continue;
                members.sort(Comparator.comparing((Person p) -> !p.needsAccessible())
                        .thenComparing(p -> !p.wantsAisle())
                        .thenComparingLong(Person::id));
                placeGroup(members);
            }
        }

        /** Random order, but bigger groups are proportionally more likely to come first. */
        private List<String> weightedOrder(Map<String, List<Person>> groups) {
            List<String> pool = new ArrayList<>(groups.keySet());
            List<String> order = new ArrayList<>(pool.size());
            while (!pool.isEmpty()) {
                int total = 0;
                for (String g : pool) total += groups.get(g).size();
                double r = rnd.nextDouble() * total;
                String chosen = pool.get(pool.size() - 1);
                for (String g : pool) {
                    r -= groups.get(g).size();
                    if (r < 0) { chosen = g; break; }
                }
                pool.remove(chosen);
                order.add(chosen);
            }
            return order;
        }

        /**
         * Seats the group in one contiguous window if possible. Otherwise takes the largest chunk that
         * fits, then places the rest in further chunks (down to single seats) as close to the first
         * chunk as possible.
         */
        private void placeGroup(List<Person> members) {
            List<Person> rest = new ArrayList<>(members);
            double[] anchor = null;
            while (!rest.isEmpty()) {
                List<Long> window = null;
                int k = rest.size();
                for (; k >= 1; k--) {
                    window = bestWindow(rest.subList(0, k), anchor);
                    if (window != null) break;
                }
                if (window == null) return;

                List<Person> chunk = rest.subList(0, k);
                Map<Long, Long> local = fillWindow(chunk, window);
                if (local.isEmpty()) return;

                List<Seat> placedSeats = new ArrayList<>();
                for (Person p : chunk) {
                    Long sid = local.get(p.id());
                    if (sid == null) continue;
                    claim(p, sid);
                    placedSeats.add(seatById.get(sid));
                }
                if (placedSeats.isEmpty()) return;
                anchor = centroid(placedSeats);
                rest.removeIf(this::isPlanned);
            }
        }

        private record Window(List<Long> seats, double penalty) {}

        /**
         * Best contiguous window of {@code chunk.size()} free seats, chosen at random among the top few.
         * Windows are ranked by the same penalty terms the scorer uses, so the greedy pulls in the
         * direction the score rewards: keep previous seats, match zones and aisles, stay near the anchor.
         */
        private List<Long> bestWindow(List<Person> chunk, double[] anchor) {
            int k = chunk.size();
            int needAcc = 0, wantAisle = 0, havePrev = 0;
            for (Person p : chunk) {
                if (p.needsAccessible()) needAcc++;
                if (p.wantsAisle()) wantAisle++;
                if (prevSeat.containsKey(p.id())) havePrev++;
            }
            // When accessible seats are scarce, a window that wastes one on a non-needer is never worth it:
            // it costs someone else their seat, which the score punishes far more than a split group.
            boolean scarceAccessible = freeAccessibleCount() <= accDemandRemaining;

            List<Window> windows = new ArrayList<>();
            for (List<Long> row : freeRows().values()) {
                for (List<Long> win : windowsOf(row, k)) {
                    int accIn = 0, aisleIn = 0, keep = 0;
                    double frontRows = 0;
                    for (long sid : win) {
                        Seat s = seatById.get(sid);
                        if (s.accessible()) accIn++;
                        if (s.aisle()) aisleIn++;
                        frontRows += geo.rowsFromFront(s);
                    }
                    if (accIn < needAcc) continue;
                    if (scarceAccessible && accIn > needAcc) continue;

                    String zone = seatById.get(win.get(0)).zone();
                    int zoneMisses = 0;
                    for (Person p : chunk) {
                        if (p.hasZone() && !p.preferredZone().equals(zone)) zoneMisses++;
                        Long prev = prevSeat.get(p.id());
                        if (prev != null && win.contains(prev)) keep++;
                    }
                    double penalty = zoneMisses * req.preferenceWeight()
                            + Math.max(0, wantAisle - aisleIn) * req.preferenceWeight()
                            + (havePrev - keep) * req.stabilityWeight()
                            + FRONT_PENALTY_PER_ROW * frontRows
                            + (accIn - needAcc) * 0.5;  // tiny tie-break against wasting accessible seats
                    if (anchor != null) {
                        List<Seat> ss = new ArrayList<>();
                        for (long sid : win) ss.add(seatById.get(sid));
                        double[] c = centroid(ss);
                        penalty += DISTANCE_PENALTY_PER_UNIT * Math.hypot(c[0] - anchor[0], c[1] - anchor[1]);
                    }
                    windows.add(new Window(win, penalty));
                }
            }
            if (windows.isEmpty()) return null;

            // Noise only among windows that are genuinely equally good.
            windows.sort(Comparator.comparingDouble(Window::penalty));
            double best = windows.get(0).penalty();
            int ties = 0;
            while (ties < windows.size() && windows.get(ties).penalty() <= best + 1e-9) ties++;
            return windows.get(rnd.nextInt(ties)).seats();
        }

        /** Free seats grouped by zone+row, each row sorted by seat number. */
        private Map<String, List<Long>> freeRows() {
            Map<String, List<Long>> rows = new LinkedHashMap<>();
            for (long sid : free) {
                Seat s = seatById.get(sid);
                if (s.seatNumber() == null) continue;
                rows.computeIfAbsent(rowKey(s), r -> new ArrayList<>()).add(sid);
            }
            for (List<Long> row : rows.values()) {
                row.sort(Comparator.comparingInt(sid -> seatById.get(sid).seatNumber()));
            }
            return rows;
        }

        /** Every run of {@code k} seats in the row whose seat numbers are consecutive. */
        private List<List<Long>> windowsOf(List<Long> row, int k) {
            List<List<Long>> wins = new ArrayList<>();
            for (int i = 0; i + k <= row.size(); i++) {
                boolean ok = true;
                for (int j = 1; j < k && ok; j++) {
                    int prev = seatById.get(row.get(i + j - 1)).seatNumber();
                    int cur = seatById.get(row.get(i + j)).seatNumber();
                    ok = cur == prev + 1;
                }
                if (ok) wins.add(new ArrayList<>(row.subList(i, i + k)));
            }
            return wins;
        }

        /** Assigns chunk members to window seats: accessible-needers, then aisle-wanters, then the rest. */
        private Map<Long, Long> fillWindow(List<Person> chunk, List<Long> window) {
            List<Long> left = new ArrayList<>(window);
            Map<Long, Long> local = new LinkedHashMap<>();

            for (Person p : chunk) {
                if (!p.needsAccessible()) continue;
                Long pick = firstMatch(left, s -> s.accessible() && hardOk(p, s));
                if (pick == null) return Map.of();
                local.put(p.id(), pick);
                left.remove(pick);
            }
            for (Person p : chunk) {
                if (p.needsAccessible() || !p.wantsAisle()) continue;
                Long pick = firstMatch(left, s -> s.aisle() && hardOk(p, s));
                if (pick != null) { local.put(p.id(), pick); left.remove(pick); }
            }
            for (Person p : chunk) {
                if (local.containsKey(p.id())) continue;
                Long pick = null;
                if (p.hasZone()) pick = firstMatch(left, s -> hardOk(p, s) && p.preferredZone().equals(s.zone()));
                if (pick == null) pick = firstMatch(left, s -> hardOk(p, s));
                if (pick == null) return Map.of();
                local.put(p.id(), pick);
                left.remove(pick);
            }
            return local;
        }

        private Long firstMatch(List<Long> sids, java.util.function.Predicate<Seat> test) {
            for (long sid : sids) if (test.test(seatById.get(sid))) return sid;
            return null;
        }

        // -- step 3: everyone else

        private void placeIndividuals() {
            List<Person> remaining = new ArrayList<>();
            for (Person p : req.people()) if (!isPlanned(p)) remaining.add(p);
            Collections.shuffle(remaining, rnd);
            Map<Long, Integer> options = new HashMap<>();
            for (Person p : remaining) options.put(p.id(), candidates(p, false).size());
            remaining.sort(Comparator.comparingInt(p -> options.get(p.id())));

            boolean progress = true;
            while (progress) {
                progress = false;
                Weights w = weights();
                for (Person p : remaining) {
                    if (isPlanned(p)) continue;
                    List<Long> cands = candidates(p, false);
                    if (memberStrict(p)) cands.removeIf(sid -> !matchesPref(p, seatById.get(sid)));
                    if (cands.isEmpty()) continue;
                    claim(p, pick(p, cands, w));
                    progress = true;
                }
            }

            // Relaxed pass: reserved accessible seats become available, preferences become soft.
            Weights w = weights();
            for (Person p : remaining) {
                if (isPlanned(p)) continue;
                List<Long> cands = candidates(p, true);
                if (cands.isEmpty()) continue;
                if (memberStrict(p)) {
                    List<Long> soft = new ArrayList<>(cands);
                    soft.removeIf(sid -> !matchesPref(p, seatById.get(sid)));
                    if (!soft.isEmpty()) cands = soft;
                }
                claim(p, pick(p, cands, w));
            }
        }

        private List<Long> candidates(Person p, boolean allowReservedAccessible) {
            List<Long> c = new ArrayList<>();
            for (long sid : free) if (hardOk(p, seatById.get(sid))) c.add(sid);
            if (p.hasZone()) {
                List<Long> inZone = new ArrayList<>();
                for (long sid : c) if (p.preferredZone().equals(seatById.get(sid).zone())) inZone.add(sid);
                if (!inZone.isEmpty()) c = inZone;
            }
            if (!allowReservedAccessible && !p.needsAccessible()) {
                if (freeAccessibleCount() <= accDemandRemaining) c.removeIf(accessibleIds::contains);
            }
            return c;
        }

        private int freeAccessibleCount() {
            int n = 0;
            for (long sid : free) if (accessibleIds.contains(sid)) n++;
            return n;
        }

        /** Demand-vs-supply pressure for the people still unseated, recomputed every pass. */
        private record Weights(Map<String, Double> zonePressure, double maxZonePressure, double aislePressure,
                               Map<Long, Double> popularity) {}

        private Weights weights() {
            Map<String, Integer> demand = new HashMap<>();
            int wantAisle = 0;
            for (Person p : req.people()) {
                if (isPlanned(p)) continue;
                if (p.hasZone()) demand.merge(p.preferredZone(), 1, Integer::sum);
                if (p.wantsAisle()) wantAisle++;
            }
            Map<String, Integer> supply = new HashMap<>();
            int freeAisle = 0;
            for (long sid : free) {
                Seat s = seatById.get(sid);
                if (s.zone() != null && !s.zone().isBlank()) supply.merge(s.zone(), 1, Integer::sum);
                if (s.aisle()) freeAisle++;
            }
            Map<String, Double> pressure = new HashMap<>();
            double maxPressure = 1.0;
            boolean any = false;
            for (Map.Entry<String, Integer> e : demand.entrySet()) {
                double pr = e.getValue() / (double) Math.max(1, supply.getOrDefault(e.getKey(), 0));
                pressure.put(e.getKey(), pr);
                maxPressure = any ? Math.max(maxPressure, pr) : pr;
                any = true;
            }
            double aislePressure = wantAisle > 0 ? Math.min(1.0, wantAisle / (double) Math.max(1, freeAisle)) : 0.0;

            Map<Long, Double> popularity = new HashMap<>();
            for (long sid : free) {
                Seat s = seatById.get(sid);
                double zp = s.zone() == null ? 0.0 : pressure.getOrDefault(s.zone(), 0.0);
                double zTerm = zp / (1.0 + zp);
                double aTerm = s.aisle() ? aislePressure : 0.0;
                popularity.put(sid, Math.max(0.0, Math.min(1.0, 0.7 * zTerm + 0.3 * aTerm)));
            }
            return new Weights(pressure, maxPressure, aislePressure, popularity);
        }

        /** Highest-scoring candidate for this person, with a little jitter so near-ties vary per run. */
        private long pick(Person p, List<Long> cands, Weights w) {
            double zoneWeight = 0.0;
            if (p.hasZone()) {
                double pr = w.zonePressure().getOrDefault(p.preferredZone(), 0.0);
                double rel = w.maxZonePressure() <= 0 ? 0.0 : Math.max(0.0, Math.min(1.0, pr / w.maxZonePressure()));
                zoneWeight = wPref * (0.7 + 0.3 * rel);
            }
            double aisleWeight = wPref * w.aislePressure();
            Long prev = prevSeat.get(p.id());

            long best = cands.get(0);
            double bestScore = Double.NEGATIVE_INFINITY;
            for (long sid : cands) {
                Seat s = seatById.get(sid);
                double score = 0.0;
                if (p.hasZone() && p.preferredZone().equals(s.zone())) score += zoneWeight;
                if (p.wantsAisle() && s.aisle()) score += aisleWeight;
                if (prev != null && prev == sid) score += wStab;
                score -= 0.15 * w.popularity().getOrDefault(sid, 0.0);
                score -= (FRONT_PENALTY_PER_ROW / 100.0) * geo.rowsFromFront(s);  // same units as the weights above
                score += rnd.nextDouble() * PICK_JITTER;
                if (score > bestScore) { bestScore = score; best = sid; }
            }
            return best;
        }
    }
}
