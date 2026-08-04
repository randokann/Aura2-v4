import base64
import requests

IMAGE_PATH = "/Users/louisuntea/Aura2/backend/food.jpg"

with open(IMAGE_PATH, "rb") as f:
    image_base64 = base64.b64encode(f.read()).decode()

response = requests.post(
    "http://127.0.0.1:8000/api/clarify-food",
    json={
        "device_id": "test-user",
        "image_base64": image_base64,
        "original_question": "What kind of spread or sauce is inside this jar?",
        "user_answer": "Chocolate or nut spread",
        "clarification_type": "ingredient",
        "lang": "en"
    }
)

print(response.status_code)
print(response.json())
