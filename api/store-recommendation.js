// Klaviyo store recommendation API
// Vercel serverless function

const CACHE_TTL = 60 * 60 * 1000
let storeCache = null
let cacheTime = 0

async function fetchStores() {

  if (storeCache && Date.now() - cacheTime < CACHE_TTL) {
    return storeCache
  }

  const res = await fetch(process.env.STORE_FEED_URL)

  if (!res.ok) {
    throw new Error("Failed loading store feed")
  }

  const stores = await res.json()

  storeCache = stores
  cacheTime = Date.now()

  return stores
}

function haversine(lat1, lon1, lat2, lon2) {

  const R = 3959

  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

async function geocodeAddress(address) {

  const url =
    "https://geocode.maps.co/search?q=" +
    encodeURIComponent(address) +
    "&api_key=" +
    process.env.GEOCODE_API_KEY

  const res = await fetch(url)
  const data = await res.json()

  if (!data || data.length === 0) {
    throw new Error("Geocoding failed")
  }

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon)
  }
}

async function updateKlaviyo(profileId, storeId) {

  const url = `https://a.klaviyo.com/api/profiles/${profileId}`

  const body = {
    data: {
      type: "profile",
      id: profileId,
      attributes: {
        properties: {
          mystorerec: storeId
        }
      }
    }
  }

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      "Content-Type": "application/json",
      revision: "2024-10-15"
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    throw new Error("Failed updating Klaviyo profile")
  }
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" })
  }

  try {

    const { profile_id, address } = req.body

    if (!profile_id || !address) {
      return res.status(400).json({
        error: "profile_id and address required"
      })
    }

    console.log("Processing profile:", profile_id)

    const location = await geocodeAddress(address)

    const stores = await fetchStores()

    const maxDistance = parseFloat(process.env.MAX_DISTANCE || "15")

    let closestStore = null
    let closestDistance = Infinity

    for (const store of stores) {

      if (!store.lat || !store.lng) continue

      const distance = haversine(
        location.lat,
        location.lng,
        parseFloat(store.lat),
        parseFloat(store.lng)
      )

      if (distance < maxDistance && distance < closestDistance) {
        closestDistance = distance
        closestStore = store
      }
    }

    if (!closestStore) {

      return res.status(200).json({
        message: "No store within radius"
      })
    }

    await updateKlaviyo(profile_id, closestStore.id)

    return res.status(200).json({
      recommended_store: closestStore.id,
      distance: closestDistance
    })

  } catch (err) {

    console.error(err)

    return res.status(500).json({
      error: err.message
    })
  }
}
