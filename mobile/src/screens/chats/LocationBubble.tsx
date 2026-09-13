import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../theme/ThemeProvider';

export interface SharedLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * A shared place, drawn as a card rather than printed as coordinates.
 *
 * The app used to render these as whatever one-line text the server built
 * for previews — "Location (22.594133, 88.393396)" in a plain bubble.
 * That is the raw data, not a place: an agent could not tell at a glance
 * where a customer was, and tapping it did nothing.
 *
 * Real map tiles, from OpenStreetMap's own embed page, in a WebView. No
 * API key and no map SDK — the URL is the whole integration, and it is
 * the same one the customer's web window loads, so both sides of a
 * conversation see the same picture.
 *
 * It does tell openstreetmap.org the coordinates, which an earlier
 * drawn-graphic version of this card deliberately avoided. That was the
 * owner's call and they made it: a picture of the actual streets is what
 * makes a shared location useful.
 */
export function LocationBubble({
  place,
  onLongPress,
}: {
  place: SharedLocation;
  onLongPress?: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  const label = place.name?.trim() || 'Shared location';
  const coords = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;

  // OpenStreetMap's embed takes a bounding box, not a zoom level. This
  // span is roughly a couple of streets across — close enough to place
  // the pin on a recognisable corner, wide enough that a GPS reading a
  // few metres out does not look like the wrong building.
  const d = 0.0025;
  const bbox = `${place.longitude - d},${place.latitude - d},${place.longitude + d},${place.latitude + d}`;
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${place.latitude},${place.longitude}`;

  const open = () => {
    // geo: is the native handler and lets Android offer every installed
    // map app rather than forcing one. The https form is the fallback for
    // a device with no geo: handler at all, where geo: would silently do
    // nothing — which is indistinguishable from a broken card.
    const geo = `geo:${place.latitude},${place.longitude}?q=${place.latitude},${place.longitude}(${encodeURIComponent(label)})`;
    const web = `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
    void (Platform.OS === 'android'
      ? Linking.openURL(geo).catch(() => Linking.openURL(web))
      : Linking.openURL(web));
  };

  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, open in maps`}
      style={[styles.card, { borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.map}>
        <WebView
          source={{ uri: embedUrl }}
          style={styles.webview}
          // A picture, not a map to pan. Every touch belongs to the card:
          // dragging inside the WebView would fight the thread's own
          // scroll, and the tap is what opens the phone's map app.
          pointerEvents="none"
          scrollEnabled={false}
          // No JS is needed to draw tiles, and the less this page can do
          // the better — it is a third-party document inside a chat.
          javaScriptEnabled={false}
          // Android renders a white card before the first tile lands;
          // matching the tile background stops it flashing.
          containerStyle={styles.webviewContainer}
          androidLayerType="software"
        />
        {/* OSM draws its own marker, but only once the tiles are in. This
            sits on top so the card reads as a location from the first
            frame rather than as a blank rectangle that gains a meaning a
            second later. */}
        <Ionicons name="location" size={30} color="#E0483D" style={styles.pin} />
      </View>

      <View style={styles.footer}>
        <View style={styles.labelRow}>
          <Ionicons name="location-outline" size={14} color={colors.primary} />
          <Text
            style={[typography.bodyMedium, { color: colors.textPrimary, marginLeft: 5, flex: 1 }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
        {/* Room on the right for the timestamp the bubble draws over this
            strip — without it the address runs underneath it. */}
        <Text
          style={[typography.caption, { color: colors.textSecondary, marginTop: 1, paddingRight: 52 }]}
          numberOfLines={1}
        >
          {place.address?.trim() || coords}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 232, overflow: 'hidden' },
  // The tile background, so the card is the right colour before the
  // first tile arrives rather than a white flash inside a dark bubble.
  map: { height: 118, width: '100%', backgroundColor: '#E8E4DF', overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  webviewContainer: { flex: 1, backgroundColor: '#E8E4DF' },
  pin: { position: 'absolute', left: 101, top: 38 },
  footer: { paddingHorizontal: 9, paddingTop: 6, paddingBottom: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
});
