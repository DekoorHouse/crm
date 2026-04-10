import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { Colors } from "../constants/theme";

interface Props {
  url: string;
  title: string;
  color: string;
  onBack: () => void;
}

export default function WebViewScreen({ url, title, color, onBack }: Props) {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleBack = () => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    } else {
      onBack();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: color }]}>
        <Pressable onPress={handleBack} style={styles.headerButton}>
          <Feather name="arrow-left" size={22} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => webViewRef.current?.reload()}
          style={styles.headerButton}
        >
          <Feather name="refresh-cw" size={18} color="#FFF" />
        </Pressable>
      </View>

      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color={color} />
        </View>
      )}

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
        }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  headerButton: {
    padding: 10,
    borderRadius: 12,
  },
  headerTitle: {
    flex: 1,
    color: "#FFF",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  loadingBar: {
    position: "absolute",
    top: 92,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  webview: {
    flex: 1,
  },
});
