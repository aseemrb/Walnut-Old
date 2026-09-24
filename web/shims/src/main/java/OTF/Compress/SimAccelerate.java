/*
 * Browser-build variant of a class from the OTF library (https://github.com/jn1z/OTF, MIT License,
 * Copyright John Nicol). It shadows the original on the TeaVM classpath. The only change is noted
 * in the comment marked WALNUT-WEB below; everything else is identical to OTF 1.1.1.
 */
package OTF.Compress;

import OTF.SmartBitSet;

import java.util.BitSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

public final class SimAccelerate {
  private static final int INITIAL_PRUNE_CAPACITY = 10_000;

  private final Map<SmartBitSet,SmartBitSet> prunedMap;

  private final SmartBitSet[] redundantStates; // redundant states associated with state i, null iff supersetState bit not set

  private final SmartBitSet supersetStates; // states that are supersets of other elements

  private final SmartBitSet subsetStates; // states that are subsets of other states
  // thus, they might be added during saturation, or removed during pruning
  private final SmartBitSet tempSupersetStatesInB;
  final boolean shouldAccelerate;

  public SimAccelerate(BitSet[] simSupersetRels, int nNFA) {
    tempSupersetStatesInB = new SmartBitSet(nNFA);
    shouldAccelerate = simSupersetRels.length > 0;
    if (!shouldAccelerate) {
      prunedMap = null;
    } else {
      if (nNFA < 1000) {
        prunedMap = new HashMap<>(INITIAL_PRUNE_CAPACITY);
      } else {
        // WALNUT-WEB: a bounded LRU map replaces the Caffeine cache, which needs threads.
        final int maxEntries = 1_000_000;
        prunedMap = new LinkedHashMap<>(INITIAL_PRUNE_CAPACITY, 0.75f, true) {
          @Override
          protected boolean removeEldestEntry(Map.Entry<SmartBitSet, SmartBitSet> eldest) {
            return size() > maxEntries;
          }
        };
      }
    }

    redundantStates = new SmartBitSet[simSupersetRels.length];
    supersetStates = new SmartBitSet(nNFA);
    subsetStates = new SmartBitSet(nNFA);
    for(int i=0;i<simSupersetRels.length;i++) {
      final BitSet b = simSupersetRels[i];
      if (b != null) {
        redundantStates[i] = SmartBitSet.valueOf(b.toLongArray());
        redundantStates[i].clear(i); // enforce strict subset: never contain i itself
        supersetStates.set(i);
        subsetStates.or(redundantStates[i]);
      }
    }
  }

  /**
   * Remove appropriate subset elements from bitset.
   * Similar to "transition pruning".
   * E.g., if {1} == {1,2}, then if the bitset contains {1}, we can remove {2}.
   * Cached in prunedMap for performance.
   * Used in get and put.
   */
  public SmartBitSet pruneEltWithSims(SmartBitSet b) {
    // Calculate all potentially prunable elements of b
    // Check if b contains any elements that are marked as potential redundant subsets (subsetStates)
    // and also if it contains any supersets (supersetStates) that imply redundancy.
    // If b doesn't intersect both of these, then there is nothing to prune.
    if (!b.intersects(subsetStates) || !b.intersects(supersetStates)) {
      return b;
    }

    SmartBitSet pruned = prunedMap.get(b);
    if (pruned == null) {
      // calculate pruned value
      calculateTempDirtySupersetStatesInB(b);
      // prune redundant subsets: for each superset, prune all subsets associated with it
      pruned = (SmartBitSet) b.clone();
      for (int i = tempSupersetStatesInB.nextSetBit(0); i >= 0; i = tempSupersetStatesInB.nextSetBit(i + 1)) {
        pruned.dirtyAndNot(redundantStates[i]);
      }
      pruned.markAsDirty();
      prunedMap.put((SmartBitSet) b.clone(), pruned); // to prevent potential post-mutation issues
    }
    return pruned;
  }

  // Calculate all supersets in b
  private void calculateTempDirtySupersetStatesInB(SmartBitSet b) {
    tempSupersetStatesInB.clear();
    tempSupersetStatesInB.dirtyOr(b);
    tempSupersetStatesInB.dirtyAnd(supersetStates);
  }

  /**
   * Add appropriate subset elements to bitset.
   * Similar to "transition saturation".
   * E.g., if {1} == {1,2}, then if the bitset contains {1}, we can add {2}.
   * Used in AC Union and find.
   * TODO: potentially could be used in unify, although the advantage there is less clear.
   */
  public SmartBitSet saturateEltWithSims(SmartBitSet b) {
    if (!b.intersects(supersetStates)) {
      return b; // there's nothing to saturate
    }
    calculateTempDirtySupersetStatesInB(b);

    // Keep only the bits that are potential redundant subsets.
    final SmartBitSet saturated = (SmartBitSet) b.clone();
    // Iterate over each state in b that is marked as a superset
    for (int i = tempSupersetStatesInB.nextSetBit(0); i >= 0; i = tempSupersetStatesInB.nextSetBit(i + 1)) {
      saturated.dirtyOr(redundantStates[i]); // Add redundant states
    }
    saturated.markAsDirty();
    return saturated;
  }
}
