/*	 Copyright 2025 John Nicol
 *
 * 	 This file is part of Walnut.
 *
 *   Walnut is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   Walnut is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with Walnut.  If not, see <http://www.gnu.org/licenses/>.
 */

package Main.Web;

import Main.WalnutException;
import org.teavm.jso.JSBody;

/**
 * Hook for aborting a command before the browser tab runs out of memory. Walnut writes a line to
 * the global log after every evaluation step, and the tracking filesystem calls
 * {@link #heartbeat()} on each write, so a check here runs throughout a computation without
 * touching the prover code. When the heap passes the configured fraction of its limit, a
 * WalnutException is thrown; the prover reports it like any other command failure and stays usable.
 *
 * STATUS: inert in practice. The only synchronous heap statistic, performance.memory, is not
 * exposed inside Web Workers by any browser (verified in Chromium), and a worker that exhausts
 * memory takes the whole tab down. Making this work needs cross-origin isolation (a service worker
 * that adds COOP/COEP headers, since GitHub Pages cannot), so the page can call
 * performance.measureUserAgentSpecificMemory() and flag pressure to the worker through a
 * SharedArrayBuffer that {@link #heapUsageFraction()} reads instead.
 */
final class MemoryGuard {
  private static final int CHECK_EVERY = 32;
  private static double limitFraction = 0.9;
  private static int counter;

  private MemoryGuard() {}

  static void setLimitFraction(double fraction) {
    limitFraction = fraction;
  }

  static void heartbeat() {
    if (++counter < CHECK_EVERY) {
      return;
    }
    counter = 0;
    double used = heapUsageFraction();
    if (used > limitFraction) {
      throw new WalnutException(String.format(
          "Stopped: this computation is using %d%% of the memory the browser allows. "
              + "Try a smaller problem, or run Walnut on the desktop where you can give it more memory.",
          Math.round(used * 100)));
    }
  }

  @JSBody(script = "var m = (typeof performance !== 'undefined') && performance.memory;"
      + "return (m && m.jsHeapSizeLimit) ? m.usedJSHeapSize / m.jsHeapSizeLimit : -1;")
  private static native double heapUsageFraction();
}
