// Updated to support all image formats

const uploadImage = (image) => {
    // Validate the image
    if (!image || !isImageValid(image)) {
        throw new Error('Invalid image file');
    }

    // Use sendDocument for all images
    sendDocument(image);
};

const isImageValid = (image) => {
    // Implement your validation logic (e.g., check file size, dimensions)
    // This can be expanded based on your specific needs
    return true;
};