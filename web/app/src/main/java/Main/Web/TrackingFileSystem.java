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

import org.teavm.runtime.fs.VirtualFile;
import org.teavm.runtime.fs.VirtualFileAccessor;
import org.teavm.runtime.fs.VirtualFileSystem;

import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Wraps TeaVM's in-memory filesystem and records which files were written or deleted, so the
 * JavaScript host can persist just those to browser storage after each command.
 */
final class TrackingFileSystem implements VirtualFileSystem {
  private final VirtualFileSystem delegate;
  private final Set<String> dirty = new LinkedHashSet<>();
  private final Set<String> deleted = new LinkedHashSet<>();

  TrackingFileSystem(VirtualFileSystem delegate) {
    this.delegate = delegate;
  }

  String[] drainDirtyPaths() {
    String[] out = dirty.toArray(new String[0]);
    dirty.clear();
    return out;
  }

  String[] drainDeletedPaths() {
    String[] out = deleted.toArray(new String[0]);
    deleted.clear();
    return out;
  }

  @Override
  public String getUserDir() {
    return delegate.getUserDir();
  }

  @Override
  public VirtualFile getFile(String path) {
    VirtualFile file = delegate.getFile(path);
    return file == null ? null : new TrackingFile(file, delegate.canonicalize(path));
  }

  @Override
  public boolean isWindows() {
    return delegate.isWindows();
  }

  @Override
  public String canonicalize(String path) {
    return delegate.canonicalize(path);
  }

  @Override
  public String[] getRoots() {
    return delegate.getRoots();
  }

  private void markDirty(String path) {
    dirty.add(path);
    deleted.remove(path);
  }

  /** Re-flags the file on every write, so files kept open across commands (logs) stay tracked. */
  private final class TrackingAccessor implements VirtualFileAccessor {
    private final VirtualFileAccessor accessor;
    private final String path;

    TrackingAccessor(VirtualFileAccessor accessor, String path) {
      this.accessor = accessor;
      this.path = path;
    }

    @Override
    public int read(byte[] buffer, int offset, int count) throws IOException {
      return accessor.read(buffer, offset, count);
    }

    @Override
    public void write(byte[] buffer, int offset, int count) throws IOException {
      accessor.write(buffer, offset, count);
      markDirty(path);
      MemoryGuard.heartbeat();
    }

    @Override
    public int tell() throws IOException {
      return accessor.tell();
    }

    @Override
    public void seek(int target) throws IOException {
      accessor.seek(target);
    }

    @Override
    public void skip(int amount) throws IOException {
      accessor.skip(amount);
    }

    @Override
    public int size() throws IOException {
      return accessor.size();
    }

    @Override
    public void resize(int size) throws IOException {
      accessor.resize(size);
      markDirty(path);
    }

    @Override
    public void close() throws IOException {
      accessor.close();
    }

    @Override
    public void flush() throws IOException {
      accessor.flush();
    }
  }

  private static String join(String dir, String name) {
    return dir.endsWith("/") ? dir + name : dir + "/" + name;
  }

  private final class TrackingFile implements VirtualFile {
    private final VirtualFile file;
    private final String path;

    TrackingFile(VirtualFile file, String path) {
      this.file = file;
      this.path = path;
    }

    @Override
    public String getName() {
      return file.getName();
    }

    @Override
    public boolean isDirectory() {
      return file.isDirectory();
    }

    @Override
    public boolean isFile() {
      return file.isFile();
    }

    @Override
    public boolean exists() {
      return file.exists();
    }

    @Override
    public String[] listFiles() {
      return file.listFiles();
    }

    @Override
    public VirtualFileAccessor createAccessor(boolean readable, boolean writable, boolean append) {
      VirtualFileAccessor accessor = file.createAccessor(readable, writable, append);
      if (accessor == null || !writable) {
        return accessor;
      }
      markDirty(path);
      return new TrackingAccessor(accessor, path);
    }

    @Override
    public boolean createFile(String fileName) throws IOException {
      boolean created = file.createFile(fileName);
      if (created) {
        markDirty(join(path, fileName));
      }
      return created;
    }

    @Override
    public boolean createDirectory(String fileName) {
      return file.createDirectory(fileName);
    }

    @Override
    public boolean delete() {
      boolean wasFile = file.isFile();
      boolean ok = file.delete();
      if (ok && wasFile) {
        dirty.remove(path);
        deleted.add(path);
      }
      return ok;
    }

    @Override
    public boolean adopt(VirtualFile source, String fileName) {
      boolean ok = file.adopt(source, fileName);
      if (ok && source instanceof TrackingFile tracked) {
        String target = join(path, fileName);
        dirty.remove(tracked.path);
        deleted.add(tracked.path);
        dirty.add(target);
        deleted.remove(target);
      }
      return ok;
    }

    @Override
    public boolean canRead() {
      return file.canRead();
    }

    @Override
    public boolean canWrite() {
      return file.canWrite();
    }

    @Override
    public long lastModified() {
      return file.lastModified();
    }

    @Override
    public boolean setLastModified(long lastModified) {
      return file.setLastModified(lastModified);
    }

    @Override
    public boolean setReadOnly(boolean readOnly) {
      return file.setReadOnly(readOnly);
    }

    @Override
    public int length() {
      return file.length();
    }
  }
}
