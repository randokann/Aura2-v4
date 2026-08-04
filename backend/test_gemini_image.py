import base64
import requests

IMAGE_PATH = "food.jpg"

with open(IMAGE_PATH, "rb") as f:
    image_base64 = base64.b64encode(f.read()).decode()

response = requests.post(
    "http://127.0.0.1:8000/api/analyze-food",
    json={
        "image_base64": image_base64,
        "mime_type": "image/jpeg",
        "lang": "en"
    }
)

print(response.status_code)
print(response.json())
