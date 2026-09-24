/*
 * Browser-build stand-in for AutomataLib's settings loader. The original scans the classpath and
 * local files and initializes SLF4J, none of which exists in the browser. Walnut never overrides
 * any AutomataLib setting, so returning the caller's default is exactly the JVM behavior.
 */
package net.automatalib.common.setting;

public final class AutomataLibSettings {
  private static final AutomataLibSettings INSTANCE = new AutomataLibSettings();

  private AutomataLibSettings() {}

  public static AutomataLibSettings getInstance() {
    return INSTANCE;
  }

  public String getProperty(AutomataLibProperty property) {
    return null;
  }

  public String getProperty(AutomataLibProperty property, String defaultValue) {
    return defaultValue;
  }
}
