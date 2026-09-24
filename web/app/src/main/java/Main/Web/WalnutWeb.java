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

import Main.Logging;
import Main.Prover;
import Main.Session;

import org.teavm.jso.JSExport;
import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.runtime.fs.VirtualFileSystemProvider;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.PrintStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Entry point of the browser build. Every public static method annotated with {@link JSExport}
 * becomes a named export of the generated ES module, so the JavaScript side (a Web Worker) can
 * feed commands in, receive console output, and move files between the in-memory Walnut
 * filesystem and browser storage.
 */
public final class WalnutWeb {
  /** Root of the Walnut home directory inside the virtual filesystem. */
  public static final String HOME = "/walnut/";

  @JSFunctor
  public interface OutputSink extends JSObject {
    void accept(String text);
  }

  private static final TrackingFileSystem fileSystem;
  private static PrintStream output;
  private static boolean initialized;

  static {
    // Must run before any file access: TeaVM's java.nio.file layer caches the filesystem instance
    // the first time it is used, and every entry point into this build goes through this class.
    fileSystem = new TrackingFileSystem(VirtualFileSystemProvider.getInstance());
    VirtualFileSystemProvider.setInstance(fileSystem);
  }

  private WalnutWeb() {}

  /** Route System.out and System.err to a JavaScript callback. Must be called before init(). */
  @JSExport
  public static void setOutput(OutputSink sink) {
    output = new PrintStream(new SinkOutputStream(sink), true, StandardCharsets.UTF_8);
    System.setOut(output);
    System.setErr(output);
  }

  /**
   * Abort commands once the JavaScript heap exceeds this fraction of its limit (default 0.9).
   * Only effective in browsers that expose performance.memory.
   */
  @JSExport
  public static void setMemoryLimitFraction(double fraction) {
    MemoryGuard.setLimitFraction(fraction);
  }

  /** Push any buffered partial line of output to the sink. */
  @JSExport
  public static void flushOutput() {
    if (output != null) {
      output.flush();
    }
  }

  /**
   * Install the tracking filesystem and start a global Walnut session rooted at {@link #HOME}.
   * Library files should be written (via writeFile) before or after this call; both work.
   */
  @JSExport
  public static void init() {
    if (initialized) {
      return;
    }
    new File(HOME).mkdirs();
    Session.setPathsAndNames(null, HOME, true);
    fileSystem.drainDirtyPaths(); // directory setup is not user data
    fileSystem.drainDeletedPaths();
    initialized = true;
  }

  @JSExport
  public static String version() {
    return Session.WALNUT_VERSION;
  }

  @JSExport
  public static String home() {
    return HOME;
  }

  /**
   * Run one or more Walnut commands, exactly as if they had been typed at the console.
   * Commands may span several lines and end with ";" or ":" (or "::").
   * @return false if an exit/quit command was executed.
   */
  @JSExport
  public static boolean run(String text) {
    if (!initialized) {
      init();
    }
    try (BufferedReader in = new BufferedReader(new StringReader(text))) {
      return Prover.mainProver.readBuffer(in, false);
    } catch (IOException e) {
      Logging.printTruncatedStackTrace(e);
      return true;
    } catch (RuntimeException e) {
      Logging.printTruncatedStackTrace(e);
      return true;
    } finally {
      flushOutput();
    }
  }

  // ---- filesystem bridge -------------------------------------------------------------------

  @JSExport
  public static void writeFile(String path, String content) {
    try {
      Path p = Path.of(path);
      Path parent = p.getParent();
      if (parent != null) {
        Files.createDirectories(parent);
      }
      Files.write(p, content.getBytes(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new RuntimeException("Could not write " + path + ": " + e.getMessage(), e);
    }
  }

  /** @return the file contents, or null if the file does not exist. */
  @JSExport
  public static String readFile(String path) {
    try {
      Path p = Path.of(path);
      if (!Files.isRegularFile(p)) {
        return null;
      }
      return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
    } catch (IOException e) {
      return null;
    }
  }

  @JSExport
  public static boolean exists(String path) {
    return new File(path).exists();
  }

  @JSExport
  public static boolean deleteFile(String path) {
    return new File(path).delete();
  }

  @JSExport
  public static void makeDirectories(String path) {
    new File(path).mkdirs();
  }

  /**
   * List the entries of a directory. Sub-directory names carry a trailing "/".
   * @return an empty array if the directory does not exist.
   */
  @JSExport
  public static String[] listDirectory(String path) {
    File dir = new File(path);
    String[] names = dir.list();
    if (names == null) {
      return new String[0];
    }
    Arrays.sort(names);
    List<String> out = new ArrayList<>(names.length);
    for (String name : names) {
      out.add(new File(dir, name).isDirectory() ? name + "/" : name);
    }
    return out.toArray(new String[0]);
  }

  /**
   * Paths of files created or written since the previous call. The JavaScript side persists
   * these to browser storage after each command.
   */
  @JSExport
  public static String[] drainDirtyPaths() {
    return fileSystem.drainDirtyPaths();
  }

  /** Paths deleted since the previous call. */
  @JSExport
  public static String[] drainDeletedPaths() {
    return fileSystem.drainDeletedPaths();
  }
}
