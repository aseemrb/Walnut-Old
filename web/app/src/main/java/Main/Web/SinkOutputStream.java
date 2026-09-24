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

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * An OutputStream that hands text to a JavaScript callback. TeaVM's PrintStream never calls
 * flush() on its own, so this stream emits whenever a newline is written, and WalnutWeb.flushOutput()
 * pushes any trailing partial line after a command finishes.
 */
final class SinkOutputStream extends OutputStream {
  private final WalnutWeb.OutputSink sink;
  private final ByteArrayOutputStream buffer = new ByteArrayOutputStream(256);

  SinkOutputStream(WalnutWeb.OutputSink sink) {
    this.sink = sink;
  }

  @Override
  public void write(int b) {
    buffer.write(b);
    if (b == '\n') {
      flush();
    }
  }

  @Override
  public void write(byte[] b, int off, int len) {
    buffer.write(b, off, len);
    for (int i = off + len - 1; i >= off; i--) {
      if (b[i] == '\n') {
        flush();
        break;
      }
    }
  }

  /** Emit everything buffered so far. Called on newlines and by WalnutWeb.flushOutput(). */
  @Override
  public void flush() {
    if (buffer.size() == 0) {
      return;
    }
    String text = buffer.toString(StandardCharsets.UTF_8);
    buffer.reset();
    sink.accept(text);
  }
}
